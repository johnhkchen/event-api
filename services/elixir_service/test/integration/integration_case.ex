defmodule EventApiWeb.IntegrationCase do
  @moduledoc """
  Test case for integration tests that communicate with external services.
  
  This case module provides helpers for:
  - Starting HTTP servers for testing
  - Managing external service dependencies
  - Health check verification
  - Service communication validation
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      use EventApiWeb.ConnCase
      import EventApiWeb.IntegrationCase

      # Service URLs
      @baml_service_url Application.compile_env(:event_api, :baml_service_url, "http://localhost:8080")
      @hono_service_url Application.compile_env(:event_api, :hono_service_url, "http://localhost:3000")
    end
  end

  setup_all do
    # Ensure test database is set up
    Ecto.Adapters.SQL.Sandbox.mode(EventApi.Repo, :manual)
    :ok
  end

  setup do
    # Each test gets a clean database state
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(EventApi.Repo)
    {:ok, []}
  end

  @doc """
  Checks if a service is healthy and available for testing.
  """
  def service_healthy?(service_url) do
    case HTTPoison.get("#{service_url}/health", [], timeout: 5000) do
      {:ok, %HTTPoison.Response{status_code: 200}} -> true
      _ -> false
    end
  end

  @doc """
  Waits for a service to become healthy or times out.
  """
  def wait_for_service(service_url, max_attempts \\ 30) do
    wait_for_service_impl(service_url, max_attempts, 0)
  end

  defp wait_for_service_impl(_service_url, max_attempts, max_attempts) do
    {:error, :timeout}
  end

  defp wait_for_service_impl(service_url, max_attempts, attempt) do
    if service_healthy?(service_url) do
      :ok
    else
      Process.sleep(1000)
      wait_for_service_impl(service_url, max_attempts, attempt + 1)
    end
  end

  @doc """
  Creates a mock HTTP server for testing service failures.
  """
  def start_mock_server(port) do
    {:ok, pid} = Task.start_link(fn ->
      {:ok, socket} = :gen_tcp.listen(port, [:binary, packet: :line, active: false, reuseaddr: true])
      accept_connections(socket)
    end)
    
    # Give the server a moment to start
    Process.sleep(100)
    {:ok, pid}
  end

  defp accept_connections(socket) do
    {:ok, client} = :gen_tcp.accept(socket)
    spawn(fn -> handle_client(client) end)
    accept_connections(socket)
  end

  defp handle_client(client) do
    case :gen_tcp.recv(client, 0) do
      {:ok, _data} ->
        response = "HTTP/1.1 500 Internal Server Error\r\n\r\n"
        :gen_tcp.send(client, response)
        :gen_tcp.close(client)
      {:error, :closed} ->
        :ok
    end
  end

  @doc """
  Validates that a service communication includes proper error handling.
  """
  def assert_service_error_handling(service_module, service_function, args) do
    # Test with invalid service URL
    original_url = Application.get_env(:event_api, :baml_service_url)
    Application.put_env(:event_api, :baml_service_url, "http://invalid-host:9999")
    
    try do
      result = apply(service_module, service_function, args)
      assert {:error, _reason} = result
    after
      Application.put_env(:event_api, :baml_service_url, original_url)
    end
  end
end