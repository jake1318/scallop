// src/hooks/useReservesData.ts

import { useState, useEffect, useRef } from "react";
import {
  fetchReservesData,
  formatReserveData,
} from "../services/suilendService";

export interface FormattedReserve {
  asset: string;
  totalDeposits: number;
  totalBorrows: number;
  ltv: string;
  borrowWeight: string;
  depositAPR: string;
  borrowAPR: string;
  raw: any;
}

export function useReservesData(refreshInterval = 0) {
  // Default to 0 to disable auto-refresh
  const [reserves, setReserves] = useState<FormattedReserve[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Use refs to prevent unnecessary API calls
  const fetchingRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null); // Track interval for cleanup

  const fetchData = async () => {
    // Prevent concurrent fetches
    if (fetchingRef.current) {
      console.log("Fetch already in progress, skipping...");
      return;
    }

    try {
      fetchingRef.current = true;
      setLoading(true);

      console.log("Fetching reserves data...");
      const rawReserves = await fetchReservesData();

      if (
        !rawReserves ||
        !Array.isArray(rawReserves) ||
        rawReserves.length === 0
      ) {
        throw new Error("Invalid or empty reserves data received");
      }

      console.log("Formatting reserves data...");
      const formatted = formatReserveData(rawReserves);

      // Check if the formatted data is valid
      if (formatted.length === 0) {
        throw new Error("Formatted reserves data is empty");
      }

      // Ensure no duplicate asset names that would cause React key warnings
      const uniqueFormatted = formatted.map((item, index) => {
        // If duplicates exist, make the asset name unique with an index
        const count = formatted.filter(
          (r, i) => i < index && r.asset === item.asset
        ).length;

        if (count > 0) {
          return {
            ...item,
            asset: `${item.asset}-${count + 1}`,
          };
        }

        return item;
      });

      setReserves(uniqueFormatted);
      setLastUpdated(new Date());
      setError(null);
      setRetryCount(0);
    } catch (err) {
      console.error("Error fetching reserves data:", err);
      setError(
        err instanceof Error ? err : new Error("Failed to fetch reserves data")
      );

      // Keep existing reserves data if we have it
      if (reserves.length === 0) {
        // Set empty reserves if we have none
        setReserves([]);
      }
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  };

  // Handle retries with increasing backoff
  useEffect(() => {
    if (error && retryCount < 3) {
      // Clear any existing timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      // Set new timer with exponential backoff
      timerRef.current = setTimeout(() => {
        setRetryCount((prev) => prev + 1);
        fetchData();
      }, 15000 * Math.pow(2, retryCount)); // 15s, 30s, 60s

      return () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      };
    }
  }, [error, retryCount]);

  // Initial fetch only (no auto-refresh)
  useEffect(() => {
    console.log("Initial fetch of reserves data");
    fetchData();

    // Clean up function to be run on unmount
    return () => {
      // Clear any existing timers
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []); // Empty dependency array = run once on mount

  // Handle refresh interval if provided
  useEffect(() => {
    // Clear any existing interval first
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Only set up interval if refreshInterval is positive
    if (refreshInterval > 0) {
      console.log(`Setting up auto-refresh interval: ${refreshInterval}ms`);

      intervalRef.current = setInterval(() => {
        // Only fetch if not already fetching
        if (!fetchingRef.current) {
          console.log(`Auto-refresh triggered after ${refreshInterval}ms`);
          fetchData();
        } else {
          console.log("Skipping auto-refresh due to ongoing fetch");
        }
      }, refreshInterval);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    } else {
      console.log("Auto-refresh disabled (interval set to 0)");
    }
  }, [refreshInterval]); // Only re-run when refreshInterval changes

  return {
    reserves,
    loading,
    error,
    lastUpdated,
    refetch: fetchData,
  };
}
