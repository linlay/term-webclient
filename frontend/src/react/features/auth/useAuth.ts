import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../shared/api/client";

export const AUTH_QUERY_KEY = ["auth-status"] as const;

export function useAuthStatus() {
  return useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: () => apiClient.getAuthStatus(),
    refetchOnWindowFocus: false
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: apiClient.login,
    onSuccess: (status) => {
      queryClient.setQueryData(AUTH_QUERY_KEY, status);
    }
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: apiClient.logout,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
    }
  });
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
