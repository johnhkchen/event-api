defmodule EventAPIWeb.HealthController do
  @moduledoc """
  Health check endpoints for monitoring and deployment health checks.
  
  Provides endpoints for:
  - Basic liveness checks
  - Readiness checks including database connectivity
  - Detailed system health with processing services status
  """
  
  use EventAPIWeb, :controller
  
  alias EventAPI.Repo
  alias EventAPI.Services.BAMLClient

  @doc """
  Basic liveness check - returns 200 if application is running
  """
  def liveness(conn, _params) do
    json(conn, %{
      status: "healthy",
      service: "event-api-elixir",
      timestamp: DateTime.utc_now(),
      uptime: uptime_seconds()
    })
  end

  @doc """
  Readiness check - verifies database connectivity and critical services
  """
  def readiness(conn, _params) do
    checks = %{
      database: check_database(),
      oban: check_oban(),
      processing_services: check_processing_services(),
      baml_service: check_baml_service()
    }
    
    overall_status = if all_healthy?(checks), do: "ready", else: "not_ready"
    status_code = if overall_status == "ready", do: 200, else: 503
    
    conn
    |> put_status(status_code)
    |> json(%{
      status: overall_status,
      service: "event-api-elixir",
      timestamp: DateTime.utc_now(),
      checks: checks
    })
  end

  @doc """
  Detailed health check with processing service status
  """
  def health(conn, _params) do
    checks = %{
      database: check_database(),
      oban: check_oban(),
      processing_services: check_processing_services(),
      baml_service: check_baml_service(),
      baml_cache: check_baml_cache(),
      system: check_system()
    }
    
    overall_status = if all_healthy?(checks), do: "healthy", else: "degraded"
    
    json(conn, %{
      status: overall_status,
      service: "event-api-elixir",
      timestamp: DateTime.utc_now(),
      uptime: uptime_seconds(),
      version: Application.spec(:event_api, :vsn) |> to_string(),
      checks: checks
    })
  end

  # Private functions

  defp check_database do
    try do
      case Repo.query("SELECT 1", []) do
        {:ok, _} -> %{status: "healthy", response_time_ms: 0}
        {:error, reason} -> %{status: "unhealthy", error: inspect(reason)}
      end
    rescue
      error -> %{status: "unhealthy", error: inspect(error)}
    end
  end

  defp check_oban do
    try do
      case Oban.check_queue(EventAPI.Oban, queue: :events) do
        {:ok, _} -> %{status: "healthy"}
        {:error, reason} -> %{status: "unhealthy", error: inspect(reason)}
      end
    rescue
      error -> %{status: "unhealthy", error: inspect(error)}
    end
  end

  defp check_processing_services do
    services = [
      EventAPI.Processing.ContentExtractor,
      EventAPI.Processing.DeduplicationService,
      EventAPI.Processing.GraphService,
      EventAPI.Processing.RecommendationEngine
    ]
    
    results = 
      services
      |> Enum.map(fn service ->
        service_name = service |> Module.split() |> List.last() |> Macro.underscore()
        status = if Process.whereis(service), do: "healthy", else: "unhealthy"
        {service_name, %{status: status}}
      end)
      |> Enum.into(%{})
    
    overall_status = 
      if Enum.all?(results, fn {_, %{status: status}} -> status == "healthy" end) do
        "healthy"
      else
        "degraded"
      end
    
    Map.put(results, :overall, %{status: overall_status})
  end

  defp check_baml_service do
    start_time = System.monotonic_time()
    
    case BAMLClient.health_check() do
      {:ok, response} -> 
        duration_ms = System.convert_time_unit(
          System.monotonic_time() - start_time,
          :native,
          :millisecond
        )
        %{
          status: "healthy", 
          response_time_ms: duration_ms,
          service_info: response
        }
      {:error, reason} -> 
        %{status: "unhealthy", error: reason}
    end
  end

  defp check_baml_cache do
    case BAMLClient.cache_stats() do
      {:ok, stats} -> 
        %{
          status: "healthy",
          stats: stats
        }
      {:error, reason} -> 
        %{status: "unhealthy", error: inspect(reason)}
    end
  end

  defp check_system do
    %{
      memory_usage: :erlang.memory(),
      process_count: :erlang.system_info(:process_count),
      port_count: :erlang.system_info(:port_count),
      ets_count: length(:ets.all())
    }
  end

  defp all_healthy?(checks) do
    Enum.all?(checks, fn
      {_, %{status: "healthy"}} -> true
      {_, %{overall: %{status: "healthy"}}} -> true
      {_, %{stats: _}} -> true  # Cache stats indicate healthy cache
      _ -> false
    end)
  end

  defp uptime_seconds do
    {uptime_ms, _} = :erlang.statistics(:wall_clock)
    div(uptime_ms, 1000)
  end
end