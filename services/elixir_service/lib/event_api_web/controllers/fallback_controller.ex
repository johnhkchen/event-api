defmodule EventAPIWeb.FallbackController do
  @moduledoc """
  Centralized error handling controller for API endpoints.
  
  This controller handles common error cases that can be returned from
  controller actions, providing consistent error responses across the API.
  """
  
  use EventAPIWeb, :controller
  require Logger

  def call(conn, {:error, :not_found}) do
    conn
    |> put_status(:not_found)
    |> json(%{success: false, error: "Resource not found"})
  end

  def call(conn, {:error, :timeout}) do
    conn
    |> put_status(:service_unavailable)
    |> json(%{
      success: false,
      error: "Service timeout",
      retry_after: 30
    })
  end

  def call(conn, {:error, :service_unavailable}) do
    conn
    |> put_status(:service_unavailable)
    |> json(%{
      success: false,
      error: "Service temporarily unavailable",
      retry_after: 60
    })
  end

  def call(conn, {:error, :invalid_params}) do
    conn
    |> put_status(:bad_request)
    |> json(%{success: false, error: "Invalid parameters"})
  end

  def call(conn, {:error, :invalid_query}) do
    conn
    |> put_status(:bad_request)
    |> json(%{success: false, error: "Invalid query format"})
  end

  def call(conn, {:error, reason}) when is_binary(reason) do
    Logger.error("Controller error: #{reason}")
    
    conn
    |> put_status(:internal_server_error)
    |> json(%{success: false, error: reason})
  end

  def call(conn, {:error, reason}) do
    Logger.error("Controller error: #{inspect(reason)}")
    
    conn
    |> put_status(:internal_server_error)
    |> json(%{success: false, error: "Internal server error"})
  end

  # Handle unexpected error formats
  def call(conn, error) do
    Logger.error("Unexpected error format: #{inspect(error)}")
    
    conn
    |> put_status(:internal_server_error)
    |> json(%{success: false, error: "Internal server error"})
  end
end