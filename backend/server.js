// server.js
require("dotenv").config();
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const NodeCache = require("node-cache");
const zlib = require("zlib");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3001;

// Create a server-side cache with longer TTL of 5 minutes
const apiCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Metadata cache with 1 day TTL
const metadataCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

// List of reliable Sui RPC endpoints
const PUBLIC_RPC_ENDPOINTS = [
  "https://fullnode.mainnet.sui.io", // Official Sui fullnode
  "https://sui-mainnet.public.blastapi.io", // BlastAPI Sui
  "https://sui.getblock.io/mainnet/", // GetBlock Sui
];

// Use a public RPC as default
const SUI_RPC_URL =
  process.env.SUI_RPC_URL && !process.env.SUI_RPC_URL.includes("YOUR_API_KEY")
    ? process.env.SUI_RPC_URL
    : PUBLIC_RPC_ENDPOINTS[0];

// Use a different public RPC as fallback
const FALLBACK_RPC_URL = PUBLIC_RPC_ENDPOINTS[1];

// Log the RPC endpoint we're using (without revealing the full API key)
const logUrl = (url) => {
  if (url.includes("ankr.com") || url.includes("getblock.io")) {
    return url.split("/").slice(0, 3).join("/") + "/***";
  }
  return url;
};

console.log(`Using Sui RPC endpoint: ${logUrl(SUI_RPC_URL)}`);
console.log(`Fallback RPC endpoint: ${FALLBACK_RPC_URL}`);

// Birdeye API constants for token metadata
const BIRDEYE_API_KEY =
  process.env.BIRDEYE_API_KEY || "22430f5885a74d3b97e7cbd01c2140aa";
const BIRDEYE_BASE_URL = "https://public-api.birdeye.so/defi/v3";
const MAX_REQUESTS_PER_SECOND = 45;

// Keep track of all active RPC requests
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 10; // Setting a safe limit

// Rate limiter for server
class ServerRateLimiter {
  constructor(maxRequestsPerMinute = 500) {
    this.maxRequestsPerMinute = maxRequestsPerMinute;
    this.requestCount = 0;
    this.lastResetTime = Date.now();

    // Reset every minute
    setInterval(() => {
      this.requestCount = 0;
      this.lastResetTime = Date.now();
      console.log(
        `Rate limit counter reset. Made ${this.requestCount} requests in the last minute.`
      );
    }, 60000);
  }

  checkLimit() {
    this.requestCount++;

    // Check if we're over the limit
    if (this.requestCount > this.maxRequestsPerMinute) {
      return false;
    }

    return true;
  }

  getCurrent() {
    return {
      count: this.requestCount,
      limit: this.maxRequestsPerMinute,
      remaining: Math.max(0, this.maxRequestsPerMinute - this.requestCount),
      resetIn: Math.ceil((this.lastResetTime + 60000 - Date.now()) / 1000),
    };
  }
}

// Create a rate limiter instance
const serverRateLimiter = new ServerRateLimiter(500);

// Rate limiter for Birdeye API
class ApiRateLimiter {
  constructor(maxRequestsPerSecond) {
    this.maxRequestsPerSecond = maxRequestsPerSecond;
    this.requestTimestamps = [];
    this.queue = [];
    this.running = false;
  }

  async schedule(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          await this.waitForRateLimit();
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      this.processQueue();
    });
  }

  async processQueue() {
    if (this.running || this.queue.length === 0) return;

    this.running = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        await task();
      }
    }

    this.running = false;
  }

  async waitForRateLimit() {
    const now = Date.now();

    // Remove timestamps older than 1 second
    this.requestTimestamps = this.requestTimestamps.filter(
      (timestamp) => now - timestamp < 1000
    );

    if (this.requestTimestamps.length >= this.maxRequestsPerSecond) {
      // Calculate how long we need to wait
      const oldestTimestamp = this.requestTimestamps[0];
      const waitTime = 1000 - (now - oldestTimestamp);

      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    // Add current timestamp to the list
    this.requestTimestamps.push(Date.now());
  }
}

// Create a rate limiter instance for Birdeye API
const birdeyeRateLimiter = new ApiRateLimiter(MAX_REQUESTS_PER_SECOND);

// Batching similar requests
const pendingRequests = {};

// Enable CORS for all routes
app.use(cors());

/**
 * Get token metadata from Birdeye API with rate limiting
 */
async function getTokenMetadata(tokenAddress) {
  // Check cache first
  const cachedMetadata = metadataCache.get(tokenAddress);
  if (cachedMetadata) {
    console.log(`Using cached Birdeye metadata for: ${tokenAddress}`);
    return cachedMetadata;
  }

  // Check if there's already a pending request for this token
  if (pendingRequests[tokenAddress]) {
    console.log(`Reusing pending request for metadata: ${tokenAddress}`);
    return pendingRequests[tokenAddress];
  }

  // Create a new promise for this request
  const requestPromise = birdeyeRateLimiter.schedule(async () => {
    try {
      // Encode the token address properly for the URL
      const encodedAddress = encodeURIComponent(tokenAddress);

      console.log(`Fetching metadata for ${tokenAddress} from Birdeye API`);

      const response = await axios.get(
        `${BIRDEYE_BASE_URL}/token/meta-data/single?address=${encodedAddress}`,
        {
          headers: {
            accept: "application/json",
            "x-chain": "sui",
            "X-API-KEY": BIRDEYE_API_KEY,
          },
          timeout: 5000, // Add a timeout to prevent hanging requests
        }
      );

      if (!response.data || !response.data.success) {
        console.warn(
          `Birdeye API unsuccessful response for ${tokenAddress}: ${JSON.stringify(
            response.data || {}
          )}`
        );
        return null;
      }

      if (response.data.success && response.data.data) {
        // Process and standardize the metadata format for Sui RPC compatibility
        const metadata = {
          decimals: response.data.data.decimals || 9, // Default to 9 if missing
          symbol: response.data.data.symbol || tokenAddress.split("::").pop(),
          name: response.data.data.name || tokenAddress.split("::").pop(),
          description:
            response.data.data.description || `Token from Birdeye API`,
        };

        // Cache the result
        metadataCache.set(tokenAddress, metadata);
        console.log(
          `Successfully fetched and cached metadata for ${tokenAddress}`
        );
        delete pendingRequests[tokenAddress]; // Remove from pending
        return metadata;
      }

      delete pendingRequests[tokenAddress]; // Remove from pending
      return null;
    } catch (error) {
      console.error(
        `Failed to fetch metadata for token ${tokenAddress}:`,
        error.message
      );
      delete pendingRequests[tokenAddress]; // Remove from pending even on error
      return null;
    }
  });

  // Store the promise so parallel requests can use it
  pendingRequests[tokenAddress] = requestPromise;
  return requestPromise;
}

// Direct RPC call function to use as a fallback if proxy fails
async function directRpcCall(method, params, id = 1) {
  try {
    // Track active requests
    activeRequests++;

    // Check if we're over concurrent limit
    if (activeRequests > MAX_CONCURRENT_REQUESTS) {
      console.log(
        `Too many concurrent requests (${activeRequests}), delaying...`
      );
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 * (activeRequests - MAX_CONCURRENT_REQUESTS))
      );
    }

    // Use our fallback RPC URL for direct calls
    const response = await axios.post(
      FALLBACK_RPC_URL,
      {
        jsonrpc: "2.0",
        id,
        method,
        params,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    activeRequests--;
    return response.data;
  } catch (error) {
    activeRequests--;
    console.error(`Direct RPC call failed for ${method}:`, error.message);
    throw error;
  }
}

// Create a more conservative rate limiting middleware that applies to all routes
app.use((req, res, next) => {
  // Skip for health check and metadata-cache endpoints
  if (req.path === "/health" || req.path === "/metadata-cache") {
    return next();
  }

  // Check server-wide rate limit
  if (!serverRateLimiter.checkLimit()) {
    const limits = serverRateLimiter.getCurrent();
    console.log(
      `Rate limit exceeded: ${limits.count}/${limits.limit}. Reset in ${limits.resetIn}s`
    );

    return res.status(429).json({
      error: "Too Many Requests",
      message: `Rate limit of ${limits.limit} requests per minute exceeded. Please try again in ${limits.resetIn} seconds.`,
      limit: limits.limit,
      current: limits.count,
      remaining: limits.remaining,
      resetIn: limits.resetIn,
      timestamp: new Date().toISOString(),
    });
  }

  next();
});

// Queue for managing concurrent requests
const requestQueue = [];
let processingRequest = false;

// Process the next request in the queue with backoff
function processNextRequest() {
  if (requestQueue.length > 0 && !processingRequest) {
    processingRequest = true;
    const next = requestQueue.shift();

    // Add delay based on queue length to prevent overwhelming the RPC
    const queueBasedDelay = Math.min(1000, requestQueue.length * 50);

    setTimeout(() => {
      next();

      // After processing a request, wait before processing the next one
      setTimeout(() => {
        processingRequest = false;
        processNextRequest();
      }, 200 + queueBasedDelay); // Base delay + queue-based delay
    }, queueBasedDelay);
  }
}

// Middleware to queue requests if needed
app.use("/sui", (req, res, next) => {
  // Only process POST requests
  if (req.method === "POST") {
    if (processingRequest || activeRequests > MAX_CONCURRENT_REQUESTS) {
      // If we're already processing a request or have too many active requests, queue this one
      requestQueue.push(() => next());
      console.log(
        `Request queued. Queue length: ${requestQueue.length}, Active requests: ${activeRequests}`
      );
    } else {
      // Process immediately
      processingRequest = true;
      next();

      // Reset processing flag with a delay
      setTimeout(() => {
        processingRequest = false;
        processNextRequest();
      }, 200);
    }
  } else {
    next();
  }
});

// Helper function to validate a JSON string before sending it to the client
function isValidJSON(str) {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

// Middleware to check and use cache before forwarding to proxy
app.use("/sui", async (req, res, next) => {
  // Only cache POST requests as they contain the RPC method calls
  if (req.method === "POST") {
    // Read request body for caching
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;
    });

    req.on("end", async () => {
      try {
        const body = JSON.parse(data);
        const method = body.method || "unknown";

        // Special handling for coin metadata requests
        if (
          method === "suix_getCoinMetadata" &&
          body.params &&
          body.params.length > 0
        ) {
          const coinType = body.params[0];

          // Check if we have this metadata in our cache
          const cachedMetadata = metadataCache.get(coinType);

          if (cachedMetadata) {
            // Return the cached metadata
            console.log(`Using cached metadata for: ${coinType}`);
            res.setHeader("Content-Type", "application/json");
            res.setHeader("X-Cache", "HIT");
            res.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                result: cachedMetadata,
              })
            );

            // Release the current request and process next
            setTimeout(() => {
              processingRequest = false;
              processNextRequest();
            }, 50);

            return;
          }

          // If not in cache, try to get from Birdeye first for problematic tokens
          try {
            const metadata = await getTokenMetadata(coinType);
            if (metadata) {
              console.log(
                `Using Birdeye metadata for: ${coinType} without RPC call`
              );
              res.setHeader("Content-Type", "application/json");
              res.setHeader("X-Metadata-Source", "birdeye-direct");
              res.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: body.id,
                  result: metadata,
                })
              );

              // Release the current request and process next
              setTimeout(() => {
                processingRequest = false;
                processNextRequest();
              }, 50);

              return;
            }
          } catch (e) {
            console.log(
              `Birdeye lookup failed for ${coinType}, will try RPC: ${e.message}`
            );
            // Continue to RPC call
          }
        }

        // Simply stringify the params directly for simpler caching
        const params = body.params ? JSON.stringify(body.params) : "";

        // Create a simple cache key
        const cacheKey = `${method}-${params}`;

        // Try to get from cache
        const cachedResponse = apiCache.get(cacheKey);

        if (cachedResponse) {
          // Validate the cached response is valid JSON before sending
          if (!isValidJSON(cachedResponse)) {
            console.warn(
              `Invalid JSON in cache for ${method}, removing and proceeding to fetch`
            );
            apiCache.del(cacheKey);
          } else {
            console.log(`Cache hit for: ${method}`);
            res.setHeader("Content-Type", "application/json");
            res.setHeader("X-Cache", "HIT");
            res.send(cachedResponse);

            // Release the current request and process next
            setTimeout(() => {
              processingRequest = false;
              processNextRequest();
            }, 50);

            return;
          }
        }

        // Try direct RPC call if we're overloaded
        if (
          activeRequests > MAX_CONCURRENT_REQUESTS ||
          requestQueue.length > 10
        ) {
          try {
            console.log(
              `System busy (active: ${activeRequests}, queue: ${requestQueue.length}), using direct RPC call for ${method}`
            );
            const result = await directRpcCall(
              method,
              body.params || [],
              body.id || 1
            );

            // Process result (similar to proxy response handling)
            if (
              method === "suix_getCoinMetadata" &&
              body.params &&
              body.params.length > 0 &&
              result.result === null
            ) {
              const coinType = body.params[0];
              try {
                const metadata = await getTokenMetadata(coinType);

                if (metadata) {
                  result.result = metadata;
                  metadataCache.set(coinType, metadata);
                } else {
                  // Fallback to generated metadata
                  const structName = coinType.split("::").pop() || "UNKNOWN";
                  const fallbackMetadata = {
                    decimals: 9, // Most Sui tokens use 9 decimals
                    symbol: structName,
                    name: structName,
                    description: `Metadata unavailable for ${coinType}`,
                  };

                  metadataCache.set(coinType, fallbackMetadata);
                  result.result = fallbackMetadata;
                }
              } catch (metadataError) {
                console.error(
                  `Error handling metadata for ${coinType}:`,
                  metadataError.message
                );
              }
            }

            res.setHeader("Content-Type", "application/json");
            res.send(JSON.stringify(result));

            if (req.cacheKey && isValidJSON(JSON.stringify(result))) {
              apiCache.set(req.cacheKey, JSON.stringify(result));
              console.log(`Cached direct RPC result for: ${method}`);
            }

            // Release the current request and process next
            setTimeout(() => {
              processingRequest = false;
              processNextRequest();
            }, 50);

            return;
          } catch (directError) {
            console.error(
              `Direct RPC call failed, falling back to proxy: ${directError.message}`
            );
            // Continue to proxy
          }
        }

        // Store the body back for the proxy middleware
        req.body = body;
        req.rawBody = data;
        req.cacheKey = cacheKey;
        next();
      } catch (error) {
        console.error("Error parsing request body:", error);
        res.status(400).json({
          error: "Invalid request",
          message: "Request body is not valid JSON",
          timestamp: new Date().toISOString(),
        });

        // Also release the request on error
        setTimeout(() => {
          processingRequest = false;
          processNextRequest();
        }, 50);
      }
    });
  } else {
    next();
  }
});

// Create proxy middleware for Sui RPC
const suiProxy = createProxyMiddleware({
  target: SUI_RPC_URL,
  changeOrigin: true,
  pathRewrite: {
    "^/sui": "", // Remove the '/sui' path when forwarding
  },
  onProxyReq: (proxyReq, req, res) => {
    // Track active requests
    activeRequests++;

    // Log outgoing requests for debugging (without revealing sensitive info)
    console.log(
      `Proxying request to Sui RPC: ${req.method} ${
        req.body?.method || ""
      } (active: ${activeRequests})`
    );

    // If we have the parsed body from previous middleware, use it
    if (req.rawBody) {
      proxyReq.setHeader("Content-Type", "application/json");
      proxyReq.setHeader("Content-Length", Buffer.byteLength(req.rawBody));

      // Disable compression to avoid parsing issues
      proxyReq.setHeader("Accept-Encoding", "identity");

      proxyReq.write(req.rawBody);
      proxyReq.end();
    }
  },
  onProxyRes: async (proxyRes, req, res) => {
    // Decrement active requests counter
    activeRequests--;

    // Check if we received an HTML error page instead of JSON
    const contentType = proxyRes.headers["content-type"];
    if (contentType && contentType.includes("html")) {
      console.error(
        "Received HTML response instead of JSON. The RPC endpoint may be invalid."
      );

      // Try a direct call to the fallback RPC as a backup
      try {
        const method = req.body?.method;
        const params = req.body?.params || [];
        const id = req.body?.id || 1;

        console.log(`Falling back to direct RPC call for ${method}`);
        const result = await directRpcCall(method, params, id);

        // Send the direct call result
        res.setHeader("Content-Type", "application/json");
        res.setHeader("X-Source", "fallback-rpc");
        res.send(JSON.stringify(result));

        // Cache this result too
        if (req.cacheKey) {
          apiCache.set(req.cacheKey, JSON.stringify(result));
          console.log(`Cached fallback RPC response for: ${method}`);
        }

        // Release the current request and process next
        setTimeout(() => {
          processingRequest = false;
          processNextRequest();
        }, 50);

        return;
      } catch (fallbackError) {
        console.error("Fallback RPC call failed:", fallbackError.message);
        res.status(502).json({
          error: "Bad Gateway",
          message: "RPC endpoint returned invalid response and fallback failed",
          timestamp: new Date().toISOString(),
        });

        // Release the current request and process next
        setTimeout(() => {
          processingRequest = false;
          processNextRequest();
        }, 50);

        return;
      }
    }

    // For POST requests, cache the response
    if (req.method === "POST" && req.cacheKey) {
      let responseBody = "";
      const contentEncoding = proxyRes.headers["content-encoding"];

      // Handle different encoding types
      if (contentEncoding === "gzip") {
        // Create a stream to decompress gzip data
        const gunzip = zlib.createGunzip();
        proxyRes.pipe(gunzip);

        gunzip.on("data", (chunk) => {
          responseBody += chunk.toString();
        });

        gunzip.on("end", async () => {
          try {
            // Validate JSON before caching
            if (!isValidJSON(responseBody)) {
              console.error("Invalid JSON response, not caching");

              // Try fallback RPC
              try {
                const method = req.body.method;
                const params = req.body.params || [];
                const id = req.body.id || 1;

                console.log(
                  `Falling back to direct RPC call for ${method} due to invalid JSON`
                );
                const result = await directRpcCall(method, params, id);

                res.setHeader("Content-Type", "application/json");
                res.setHeader("X-Source", "fallback-rpc");
                res.send(JSON.stringify(result));

                if (req.cacheKey && isValidJSON(JSON.stringify(result))) {
                  apiCache.set(req.cacheKey, JSON.stringify(result));
                }

                setTimeout(() => {
                  processingRequest = false;
                  processNextRequest();
                }, 50);

                return;
              } catch (fallbackError) {
                console.error(
                  "Fallback RPC call failed:",
                  fallbackError.message
                );
                res.status(502).json({
                  error: "Bad Gateway",
                  message:
                    "Invalid response from RPC endpoint and fallback failed",
                  timestamp: new Date().toISOString(),
                });

                setTimeout(() => {
                  processingRequest = false;
                  processNextRequest();
                }, 50);

                return;
              }
            }

            // Parse the response
            const responseObj = JSON.parse(responseBody);

            // Special handling for coin metadata requests that returned null
            if (
              req.body.method === "suix_getCoinMetadata" &&
              req.body.params &&
              req.body.params.length > 0 &&
              responseObj.result === null
            ) {
              const coinType = req.body.params[0];
              console.log(
                `Missing metadata for ${coinType}, fetching from Birdeye`
              );

              try {
                // Fetch metadata from Birdeye API
                const metadata = await getTokenMetadata(coinType);

                if (metadata) {
                  // Save in our local cache
                  metadataCache.set(coinType, metadata);

                  // Update the response with our metadata
                  const updatedResponse = {
                    ...responseObj,
                    result: metadata,
                  };

                  // Send the updated response
                  res.setHeader("Content-Type", "application/json");
                  res.setHeader("X-Metadata-Source", "birdeye");
                  res.send(JSON.stringify(updatedResponse));

                  // Also cache this updated response
                  apiCache.set(req.cacheKey, JSON.stringify(updatedResponse));
                  console.log(`Cached Birdeye metadata for: ${coinType}`);

                  // Release the current request and process next
                  setTimeout(() => {
                    processingRequest = false;
                    processNextRequest();
                  }, 50);

                  return;
                } else {
                  // Birdeye didn't have the metadata either, create a fallback
                  const structName = coinType.split("::").pop() || "UNKNOWN";
                  const fallbackMetadata = {
                    decimals: 9, // Most Sui tokens use 9 decimals
                    symbol: structName,
                    name: structName,
                    description: `Metadata unavailable for ${coinType}`,
                  };

                  // Cache this fallback
                  metadataCache.set(coinType, fallbackMetadata);

                  // Update the response with fallback metadata
                  const updatedResponse = {
                    ...responseObj,
                    result: fallbackMetadata,
                  };

                  // Send the updated response
                  res.setHeader("Content-Type", "application/json");
                  res.setHeader("X-Metadata-Source", "fallback");
                  res.send(JSON.stringify(updatedResponse));

                  // Also cache this updated response
                  apiCache.set(req.cacheKey, JSON.stringify(updatedResponse));
                  console.log(`Using fallback metadata for: ${coinType}`);

                  // Release the current request and process next
                  setTimeout(() => {
                    processingRequest = false;
                    processNextRequest();
                  }, 50);

                  return;
                }
              } catch (metadataError) {
                console.error(
                  `Error fetching Birdeye metadata for ${coinType}:`,
                  metadataError
                );
                // We'll continue and return the original null response
              }
            }

            // Normal caching for responses
            apiCache.set(req.cacheKey, responseBody);
            console.log(`Cached gzip response for: ${req.body.method}`);
          } catch (error) {
            console.error(
              "Error parsing or caching gzipped response:",
              error.message.substring(0, 100)
            );
          } finally {
            // Release the current request and process next
            setTimeout(() => {
              processingRequest = false;
              processNextRequest();
            }, 50);
          }
        });
      } else if (contentEncoding === "br") {
        // Handle brotli compression - abbreviated same pattern as above
        const brotliDecompress = zlib.createBrotliDecompress();
        proxyRes.pipe(brotliDecompress);

        brotliDecompress.on("data", (chunk) => {
          responseBody += chunk.toString();
        });

        brotliDecompress.on("end", async () => {
          // Process as above (abbreviated)
          try {
            if (!isValidJSON(responseBody)) {
              console.error(
                "Invalid JSON response from brotli compression, not caching"
              );

              setTimeout(() => {
                processingRequest = false;
                processNextRequest();
              }, 50);
              return;
            }

            const responseObj = JSON.parse(responseBody);

            // Special handling for coin metadata requests that returned null
            if (
              req.body.method === "suix_getCoinMetadata" &&
              req.body.params &&
              req.body.params.length > 0 &&
              responseObj.result === null
            ) {
              // Fetch metadata (abbreviated)
              const coinType = req.body.params[0];
              console.log(
                `Missing metadata for ${coinType}, fetching from Birdeye`
              );

              try {
                const metadata = await getTokenMetadata(coinType);
                if (metadata) {
                  metadataCache.set(coinType, metadata);
                  const updatedResponse = { ...responseObj, result: metadata };
                  res.setHeader("Content-Type", "application/json");
                  res.setHeader("X-Metadata-Source", "birdeye");
                  res.send(JSON.stringify(updatedResponse));
                  apiCache.set(req.cacheKey, JSON.stringify(updatedResponse));
                  console.log(`Cached Birdeye metadata for: ${coinType}`);

                  setTimeout(() => {
                    processingRequest = false;
                    processNextRequest();
                  }, 50);
                  return;
                } else {
                  // Fallback (abbreviated)
                  const structName = coinType.split("::").pop() || "UNKNOWN";
                  const fallbackMetadata = {
                    decimals: 9,
                    symbol: structName,
                    name: structName,
                    description: `Metadata unavailable for ${coinType}`,
                  };

                  metadataCache.set(coinType, fallbackMetadata);
                  const updatedResponse = {
                    ...responseObj,
                    result: fallbackMetadata,
                  };
                  res.setHeader("Content-Type", "application/json");
                  res.setHeader("X-Metadata-Source", "fallback");
                  res.send(JSON.stringify(updatedResponse));
                  apiCache.set(req.cacheKey, JSON.stringify(updatedResponse));
                  console.log(`Using fallback metadata for: ${coinType}`);

                  setTimeout(() => {
                    processingRequest = false;
                    processNextRequest();
                  }, 50);
                  return;
                }
              } catch (metadataError) {
                console.error(
                  `Error fetching Birdeye metadata for ${coinType}:`,
                  metadataError
                );
              }
            }

            apiCache.set(req.cacheKey, responseBody);
            console.log(`Cached brotli response for: ${req.body.method}`);
          } catch (error) {
            console.error(
              "Error parsing/caching brotli response:",
              error.message.substring(0, 100)
            );
          } finally {
            setTimeout(() => {
              processingRequest = false;
              processNextRequest();
            }, 50);
          }
        });
      } else if (contentEncoding === "deflate") {
        // Handle deflate compression - abbreviated as above
        const inflate = zlib.createInflate();
        proxyRes.pipe(inflate);

        inflate.on("data", (chunk) => {
          responseBody += chunk.toString();
        });
        inflate.on("end", async () => {
          // Process as above (abbreviated)
          try {
            if (!isValidJSON(responseBody)) {
              console.error(
                "Invalid JSON from deflate compression, not caching"
              );
              setTimeout(() => {
                processingRequest = false;
                processNextRequest();
              }, 50);
              return;
            }

            const responseObj = JSON.parse(responseBody);

            // Special handling for coin metadata (abbreviated)
            if (
              req.body.method === "suix_getCoinMetadata" &&
              req.body.params?.length > 0 &&
              responseObj.result === null
            ) {
              const coinType = req.body.params[0];
              console.log(
                `Missing metadata for ${coinType}, fetching from Birdeye`
              );

              try {
                const metadata = await getTokenMetadata(coinType);
                if (metadata) {
                  // Success path (abbreviated)
                  metadataCache.set(coinType, metadata);
                  const updatedResponse = { ...responseObj, result: metadata };
                  res.setHeader("Content-Type", "application/json");
                  res.setHeader("X-Metadata-Source", "birdeye");
                  res.send(JSON.stringify(updatedResponse));
                  apiCache.set(req.cacheKey, JSON.stringify(updatedResponse));
                  setTimeout(() => {
                    processingRequest = false;
                    processNextRequest();
                  }, 50);
                  return;
                } else {
                  // Fallback path (abbreviated)
                  const structName = coinType.split("::").pop() || "UNKNOWN";
                  const fallbackMetadata = {
                    decimals: 9,
                    symbol: structName,
                    name: structName,
                    description: `Metadata unavailable for ${coinType}`,
                  };

                  metadataCache.set(coinType, fallbackMetadata);
                  const updatedResponse = {
                    ...responseObj,
                    result: fallbackMetadata,
                  };
                  res.setHeader("Content-Type", "application/json");
                  res.setHeader("X-Metadata-Source", "fallback");
                  res.send(JSON.stringify(updatedResponse));
                  apiCache.set(req.cacheKey, JSON.stringify(updatedResponse));
                  setTimeout(() => {
                    processingRequest = false;
                    processNextRequest();
                  }, 50);
                  return;
                }
              } catch (metadataError) {
                console.error(
                  `Error fetching Birdeye metadata: ${metadataError.message}`
                );
              }
            }

            apiCache.set(req.cacheKey, responseBody);
            console.log(`Cached deflate response for: ${req.body.method}`);
          } catch (error) {
            console.error(
              "Error with deflate response:",
              error.message.substring(0, 100)
            );
          } finally {
            setTimeout(() => {
              processingRequest = false;
              processNextRequest();
            }, 50);
          }
        });
      } else {
        // No compression, handle normally (abbreviated for brevity)
        proxyRes.on("data", (chunk) => {
          responseBody += chunk.toString();
        });
        proxyRes.on("end", async () => {
          try {
            if (
              !responseBody ||
              !responseBody.trim() ||
              !isValidJSON(responseBody)
            ) {
              console.error("Invalid/empty JSON response, not caching");

              // Try fallback if needed (abbreviated)
              try {
                const method = req.body.method;
                const params = req.body.params || [];
                const id = req.body.id || 1;
                console.log(
                  `Using fallback RPC for invalid response: ${method}`
                );
                const result = await directRpcCall(method, params, id);
                res.setHeader("Content-Type", "application/json");
                res.send(JSON.stringify(result));
                if (req.cacheKey)
                  apiCache.set(req.cacheKey, JSON.stringify(result));
              } catch (fallbackError) {
                console.error("Fallback RPC failed:", fallbackError.message);
                res.status(502).json({
                  error: "Bad Gateway",
                  message: "Invalid response from RPC and fallback failed",
                });
              }

              setTimeout(() => {
                processingRequest = false;
                processNextRequest();
              }, 50);
              return;
            }

            const responseObj = JSON.parse(responseBody);

            // Special handling for coin metadata (abbreviated)
            if (
              req.body.method === "suix_getCoinMetadata" &&
              req.body.params?.length > 0 &&
              responseObj.result === null
            ) {
              const coinType = req.body.params[0];
              console.log(
                `Missing metadata for ${coinType}, fetching from Birdeye`
              );

              try {
                const metadata = await getTokenMetadata(coinType);
                if (metadata) {
                  // Success path (abbreviated)
                  metadataCache.set(coinType, metadata);
                  const updatedResponse = { ...responseObj, result: metadata };
                  res.setHeader("Content-Type", "application/json");
                  res.setHeader("X-Metadata-Source", "birdeye");
                  res.send(JSON.stringify(updatedResponse));
                  apiCache.set(req.cacheKey, JSON.stringify(updatedResponse));
                  setTimeout(() => {
                    processingRequest = false;
                    processNextRequest();
                  }, 50);
                  return;
                } else {
                  // Fallback path (abbreviated)
                  const structName = coinType.split("::").pop() || "UNKNOWN";
                  const fallbackMetadata = {
                    decimals: 9,
                    symbol: structName,
                    name: structName,
                    description: `Metadata unavailable for ${coinType}`,
                  };

                  metadataCache.set(coinType, fallbackMetadata);
                  const updatedResponse = {
                    ...responseObj,
                    result: fallbackMetadata,
                  };
                  res.setHeader("Content-Type", "application/json");
                  res.setHeader("X-Metadata-Source", "fallback");
                  res.send(JSON.stringify(updatedResponse));
                  apiCache.set(req.cacheKey, JSON.stringify(updatedResponse));
                  setTimeout(() => {
                    processingRequest = false;
                    processNextRequest();
                  }, 50);
                  return;
                }
              } catch (metadataError) {
                console.error(
                  `Error fetching Birdeye metadata: ${metadataError.message}`
                );
              }
            }

            apiCache.set(req.cacheKey, responseBody);
            console.log(`Cached response for: ${req.body.method}`);
          } catch (error) {
            console.error(
              "Error processing response:",
              error.message.substring(0, 100)
            );
          } finally {
            setTimeout(() => {
              processingRequest = false;
              processNextRequest();
            }, 50);
          }
        });
      }
    } else {
      // For non-cacheable requests, still release the queue
      setTimeout(() => {
        processingRequest = false;
        processNextRequest();
      }, 50);
    }

    // Add CORS headers to the proxied response
    proxyRes.headers["Access-Control-Allow-Origin"] = "*";
    proxyRes.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    proxyRes.headers["Access-Control-Allow-Headers"] =
      "Content-Type, Authorization";

    // Remove any content-encoding headers to prevent browser from trying to decode
    // Since we're handling decompression on the server
    delete proxyRes.headers["content-encoding"];
  },
  onError: async (err, req, res) => {
    console.error("Proxy error:", err);

    // Decrement active requests counter
    activeRequests--;

    // Try a direct fallback call if the proxy fails
    try {
      const method = req.body?.method;
      const params = req.body?.params || [];
      const id = req.body?.id || 1;

      if (method) {
        console.log(`Using fallback RPC due to proxy error for ${method}`);
        const result = await directRpcCall(method, params, id);

        // Special handling for coin metadata result
        if (
          method === "suix_getCoinMetadata" &&
          params?.length > 0 &&
          result.result === null
        ) {
          const coinType = params[0];
          try {
            const metadata = await getTokenMetadata(coinType);
            if (metadata) {
              result.result = metadata;
            } else {
              const structName = coinType.split("::").pop() || "UNKNOWN";
              result.result = {
                decimals: 9,
                symbol: structName,
                name: structName,
                description: `Metadata unavailable for ${coinType}`,
              };
            }
          } catch (e) {
            // Continue with null result
          }
        }

        res.setHeader("Content-Type", "application/json");
        res.setHeader("X-Source", "fallback-rpc");
        res.send(JSON.stringify(result));

        if (req.cacheKey) {
          apiCache.set(req.cacheKey, JSON.stringify(result));
        }

        setTimeout(() => {
          processingRequest = false;
          processNextRequest();
        }, 50);

        return;
      }
    } catch (fallbackError) {
      console.error("Fallback RPC call failed:", fallbackError.message);
    }

    // If fallback fails or there's no method info, return standard error
    // Improved error handling for rate limit errors
    if (
      err.code === "ECONNRESET" ||
      (err.message && err.message.includes("429"))
    ) {
      res.status(429).json({
        error: "Rate limit exceeded",
        message:
          "The RPC endpoint is currently experiencing high traffic. Please try again later.",
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(502).json({
        error: "Bad Gateway",
        message: `${err.message}. Please check your network connection and try again.`,
        timestamp: new Date().toISOString(),
      });
    }

    // Release the current request and process next
    setTimeout(() => {
      processingRequest = false;
      processNextRequest();
    }, 50);
  },
});

// Use the proxy for requests to /sui path
app.use("/sui", suiProxy);

// Endpoint to view or manage cached metadata
app.get("/metadata-cache", (req, res) => {
  const keys = metadataCache.keys();
  const result = {};

  keys.forEach((key) => {
    result[key] = metadataCache.get(key);
  });

  res.json({
    count: keys.length,
    metadata: result,
  });
});

// Health check endpoint with cache stats
app.get("/health", (req, res) => {
  const cacheStats = apiCache.getStats();
  const metadataCacheStats = metadataCache.getStats();
  const rateLimitInfo = serverRateLimiter.getCurrent();

  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    rpcEndpoint: logUrl(SUI_RPC_URL),
    fallbackRpc: FALLBACK_RPC_URL,
    cache: {
      keys: apiCache.keys().length,
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      ksize: cacheStats.ksize,
      vsize: cacheStats.vsize,
    },
    metadataCache: {
      keys: metadataCache.keys().length,
      hits: metadataCacheStats.hits,
      misses: metadataCacheStats.misses,
    },
    queue: {
      length: requestQueue.length,
      processing: processingRequest,
      activeRequests,
    },
    rateLimit: {
      current: rateLimitInfo.count,
      limit: rateLimitInfo.limit,
      remaining: rateLimitInfo.remaining,
      resetIn: `${rateLimitInfo.resetIn} seconds`,
    },
  });
});

// Manually clear expired cache items every 10 minutes
setInterval(() => {
  console.log("Clearing expired cache items");
  apiCache.flushStale();
}, 600000);

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
  console.log(`RPC endpoint: ${logUrl(SUI_RPC_URL)}`);
  console.log(`Fallback RPC: ${FALLBACK_RPC_URL}`);
  console.log(`Cache TTL: 300 seconds`);
  console.log(
    `Server-wide rate limit: ${serverRateLimiter.maxRequestsPerMinute} requests per minute`
  );
  console.log(`Max concurrent requests: ${MAX_CONCURRENT_REQUESTS}`);
  console.log(`Birdeye fallback enabled for missing token metadata`);
});
