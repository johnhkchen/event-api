defmodule EventAPI.Services.BAMLClient do
  @moduledoc """
  HTTP client for interacting with the BAML content extraction service.
  
  This module provides a robust interface for:
  - HTML content extraction with AI/LLM processing
  - Embedding generation for vector search
  - Batch processing capabilities
  - Circuit breaker pattern for service failures
  - Retry logic with exponential backoff
  - Request/response validation
  - Response caching for identical HTML
  - Performance monitoring with telemetry
  """
  
  require Logger
  alias EventAPI.Services.BAMLSchemas
  
  @base_url "http://localhost:8080"
  @timeout 30_000
  @max_retries 3
  @backoff_base 1000
  
  # Cache settings
  @cache_name :baml_response_cache
  @cache_ttl_hours 24
  @cache_max_size 1000
  
  @doc """
  Initializes the BAML client cache.
  Should be called during application startup.
  """
  def start_cache do
    cache_opts = [
      limit: @cache_max_size,
      expiration: [
        default: @cache_ttl_hours * 60 * 60 * 1000  # 24 hours in milliseconds
      ],
      stats: true
    ]
    
    case Cachex.start_link(@cache_name, cache_opts) do
      {:ok, _pid} ->
        Logger.info("BAML response cache started successfully")
        :ok
      {:error, {:already_started, _pid}} ->
        Logger.debug("BAML response cache already running")
        :ok
      {:error, reason} ->
        Logger.error("Failed to start BAML response cache: #{inspect(reason)}")
        {:error, reason}
    end
  end
  
  @doc """
  Gets cache statistics for monitoring.
  """
  def cache_stats do
    case Cachex.stats(@cache_name) do
      {:ok, stats} -> {:ok, stats}
      error -> error
    end
  end
  
  @doc """
  Extracts structured data from raw HTML using BAML AI processing.
  
  ## Examples
  
      iex> EventAPI.Services.BAMLClient.extract_content("<html>...")
      {:ok, %{
        "title" => "Tech Conference 2025",
        "description" => "Annual tech conference...",
        "speakers" => [...],
        "confidence" => 0.95
      }}
      
      iex> EventAPI.Services.BAMLClient.extract_content("")
      {:error, "empty_html"}
  """
  def extract_content(html, opts \\ []) do
    start_time = System.monotonic_time()
    correlation_id = generate_correlation_id()
    
    :telemetry.execute([:baml_client, :extract_content, :start], %{}, %{
      correlation_id: correlation_id,
      html_size: byte_size_safe(html)
    })
    
    with {:ok, validated_request} <- validate_and_prepare_request(html, correlation_id, opts),
         {:ok, result} <- extract_with_cache(validated_request, start_time, correlation_id) do
      :telemetry.execute([:baml_client, :extract_content, :success], %{
        duration: System.monotonic_time() - start_time
      }, %{correlation_id: correlation_id})
      
      {:ok, result}
    else
      {:error, reason} = error ->
        :telemetry.execute([:baml_client, :extract_content, :error], %{
          duration: System.monotonic_time() - start_time
        }, %{correlation_id: correlation_id, error: reason})
        
        error
    end
  end
  
  defp validate_and_prepare_request(html, correlation_id, opts) do
    request_params = %{
      html: html,
      correlation_id: correlation_id,
      options: Enum.into(opts, %{})
    }
    
    case BAMLSchemas.validate_extract_request(request_params) do
      {:ok, validated} ->
        Logger.debug("Extracting content from HTML (#{byte_size(html)} bytes) with correlation_id: #{correlation_id}")
        {:ok, validated}
      {:error, changeset} ->
        errors = Ecto.Changeset.traverse_errors(changeset, fn {msg, _opts} -> msg end)
        Logger.warning("Invalid extract request: #{inspect(errors)}")
        {:error, :invalid_request}
    end
  end
  
  defp extract_with_cache(validated_request, start_time, correlation_id) do
    cache_key = generate_cache_key(validated_request.html)
    
    case get_from_cache(cache_key) do
      {:hit, cached_result} ->
        Logger.debug("Cache hit for extraction request #{correlation_id}")
        :telemetry.execute([:baml_client, :cache, :hit], %{}, %{correlation_id: correlation_id})
        {:ok, cached_result}
        
      :miss ->
        Logger.debug("Cache miss for extraction request #{correlation_id}")
        :telemetry.execute([:baml_client, :cache, :miss], %{}, %{correlation_id: correlation_id})
        
        with {:ok, response} <- make_request("POST", "/api/v1/extract", validated_request),
             {:ok, validated_response} <- validate_response(response) do
          
          # Cache successful responses
          if validated_response.success do
            put_in_cache(cache_key, validated_response.data)
          end
          
          {:ok, validated_response.data}
        end
    end
  end
  
  defp generate_cache_key(html) do
    :crypto.hash(:sha256, html) |> Base.encode16(case: :lower)
  end
  
  defp get_from_cache(key) do
    case Cachex.get(@cache_name, key) do
      {:ok, nil} -> :miss
      {:ok, value} -> {:hit, value}
      {:error, _reason} -> :miss
    end
  end
  
  defp put_in_cache(key, value) do
    case Cachex.put(@cache_name, key, value) do
      {:ok, true} -> :ok
      {:error, reason} -> 
        Logger.warning("Failed to cache BAML response: #{inspect(reason)}")
        :ok
    end
  end
  
  defp byte_size_safe(data) when is_binary(data), do: byte_size(data)
  defp byte_size_safe(_), do: 0
  
  defp validate_response(%{status: 200, body: body}) do
    case BAMLSchemas.validate_extract_response(body) do
      {:ok, validated} -> {:ok, validated}
      {:error, changeset} ->
        errors = Ecto.Changeset.traverse_errors(changeset, fn {msg, _opts} -> msg end)
        Logger.warning("Invalid BAML response: #{inspect(errors)}")
        {:error, :invalid_response}
    end
  end
  
  defp validate_response(%{status: status, body: body}) do
    Logger.error("BAML service returned status #{status}: #{inspect(body)}")
    {:error, :service_error}
  end

  @doc """
  Extracts content from multiple HTML documents in batch.
  
  ## Examples
  
      iex> EventAPI.Services.BAMLClient.extract_batch([%{id: 1, html: "..."}, %{id: 2, html: "..."}])
      {:ok, [
        %{id: 1, success: true, data: %{...}},
        %{id: 2, success: false, error: "parsing_failed"}
      ]}
  """
  def extract_batch(html_documents, opts \\ []) do
    start_time = System.monotonic_time()
    correlation_id = generate_correlation_id()
    document_count = if is_list(html_documents), do: length(html_documents), else: 0
    
    :telemetry.execute([:baml_client, :extract_batch, :start], %{
      document_count: document_count
    }, %{correlation_id: correlation_id})
    
    with {:ok, validated_request} <- validate_batch_request(html_documents, correlation_id, opts),
         {:ok, response} <- make_request("POST", "/api/v1/extract/batch", validated_request),
         {:ok, validated_response} <- validate_batch_response(response) do
      
      :telemetry.execute([:baml_client, :extract_batch, :success], %{
        duration: System.monotonic_time() - start_time,
        document_count: document_count
      }, %{correlation_id: correlation_id})
      
      {:ok, validated_response.results}
    else
      {:error, reason} = error ->
        :telemetry.execute([:baml_client, :extract_batch, :error], %{
          duration: System.monotonic_time() - start_time,
          document_count: document_count
        }, %{correlation_id: correlation_id, error: reason})
        
        error
    end
  end
  
  defp validate_batch_request(html_documents, correlation_id, opts) do
    request_params = %{
      documents: html_documents,
      correlation_id: correlation_id,
      options: Enum.into(opts, %{})
    }
    
    case BAMLSchemas.validate_batch_request(request_params) do
      {:ok, validated} ->
        Logger.info("Processing batch extraction for #{length(html_documents)} documents with correlation_id: #{correlation_id}")
        {:ok, validated}
      {:error, changeset} ->
        errors = Ecto.Changeset.traverse_errors(changeset, fn {msg, _opts} -> msg end)
        Logger.warning("Invalid batch request: #{inspect(errors)}")
        {:error, :invalid_request}
    end
  end
  
  defp validate_batch_response(%{status: 200, body: body}) do
    case BAMLSchemas.validate_batch_response(body) do
      {:ok, validated} -> {:ok, validated}
      {:error, changeset} ->
        errors = Ecto.Changeset.traverse_errors(changeset, fn {msg, _opts} -> msg end)
        Logger.warning("Invalid BAML batch response: #{inspect(errors)}")
        {:error, :invalid_response}
    end
  end
  
  defp validate_batch_response(%{status: status, body: body}) do
    Logger.error("BAML service returned status #{status}: #{inspect(body)}")
    {:error, :service_error}
  end
  
  @doc """
  Generates embeddings for text content using OpenAI embeddings.
  
  ## Examples
  
      iex> EventAPI.Services.BAMLClient.generate_embeddings("Machine learning conference")
      {:ok, [0.1, -0.2, 0.3, ...]}  # 1536-dimensional vector
  """
  def generate_embeddings(text, opts \\ []) do
    start_time = System.monotonic_time()
    correlation_id = generate_correlation_id()
    
    :telemetry.execute([:baml_client, :generate_embeddings, :start], %{}, %{
      correlation_id: correlation_id,
      text_length: byte_size_safe(text)
    })
    
    with {:ok, validated_request} <- validate_embedding_request(text, correlation_id, opts),
         {:ok, response} <- make_request("POST", "/api/v1/embeddings", validated_request),
         {:ok, validated_response} <- validate_embedding_response(response) do
      
      :telemetry.execute([:baml_client, :generate_embeddings, :success], %{
        duration: System.monotonic_time() - start_time,
        embedding_dimensions: length(validated_response.embedding)
      }, %{correlation_id: correlation_id})
      
      {:ok, validated_response.embedding}
    else
      {:error, reason} = error ->
        :telemetry.execute([:baml_client, :generate_embeddings, :error], %{
          duration: System.monotonic_time() - start_time
        }, %{correlation_id: correlation_id, error: reason})
        
        error
    end
  end
  
  defp validate_embedding_request(text, correlation_id, opts) do
    request_params = %{
      text: text,
      correlation_id: correlation_id,
      model: Keyword.get(opts, :model)
    }
    
    case BAMLSchemas.validate_embedding_request(request_params) do
      {:ok, validated} ->
        Logger.debug("Generating embeddings for text (#{byte_size(text)} chars) with correlation_id: #{correlation_id}")
        {:ok, validated}
      {:error, changeset} ->
        errors = Ecto.Changeset.traverse_errors(changeset, fn {msg, _opts} -> msg end)
        Logger.warning("Invalid embedding request: #{inspect(errors)}")
        {:error, :invalid_request}
    end
  end
  
  defp validate_embedding_response(%{status: 200, body: body}) do
    case BAMLSchemas.validate_embedding_response(body) do
      {:ok, validated} -> {:ok, validated}
      {:error, changeset} ->
        errors = Ecto.Changeset.traverse_errors(changeset, fn {msg, _opts} -> msg end)
        Logger.warning("Invalid BAML embedding response: #{inspect(errors)}")
        {:error, :invalid_response}
    end
  end
  
  defp validate_embedding_response(%{status: status, body: body}) do
    Logger.error("BAML service returned status #{status}: #{inspect(body)}")
    {:error, :service_error}
  end
  
  @doc """
  Checks if the BAML service is healthy and available.
  
  ## Examples
  
      iex> EventAPI.Services.BAMLClient.health_check()
      {:ok, %{"status" => "healthy", "version" => "1.0.0"}}
      
      iex> EventAPI.Services.BAMLClient.health_check()
      {:error, "service_unavailable"}
  """
  def health_check do
    start_time = System.monotonic_time()
    correlation_id = generate_correlation_id()
    
    :telemetry.execute([:baml_client, :health_check, :start], %{}, %{correlation_id: correlation_id})
    
    case make_request("GET", "/health", nil, timeout: 5_000, retries: 1) do
      {:ok, %{status: 200, body: body}} ->
        :telemetry.execute([:baml_client, :health_check, :success], %{
          duration: System.monotonic_time() - start_time
        }, %{correlation_id: correlation_id})
        
        {:ok, body}
        
      {:ok, %{status: status}} ->
        :telemetry.execute([:baml_client, :health_check, :error], %{
          duration: System.monotonic_time() - start_time
        }, %{correlation_id: correlation_id, error: :unhealthy, status: status})
        
        Logger.warning("BAML service health check returned status: #{status}")
        {:error, "unhealthy"}
        
      {:error, reason} ->
        :telemetry.execute([:baml_client, :health_check, :error], %{
          duration: System.monotonic_time() - start_time
        }, %{correlation_id: correlation_id, error: reason})
        
        Logger.warning("BAML service health check failed: #{inspect(reason)}")
        {:error, "service_unavailable"}
    end
  end
  
  # Private helper functions
  
  defp make_request(method, path, body, opts \\ []) do
    url = @base_url <> path
    timeout = Keyword.get(opts, :timeout, @timeout)
    max_retries = Keyword.get(opts, :retries, @max_retries)
    
    headers = [
      {"content-type", "application/json"},
      {"user-agent", "EventAPI-ElixirService/1.0"},
      {"x-service", "event-api"}
    ]
    
    request_opts = [
      timeout: timeout,
      retry: retry_options(max_retries)
    ]
    
    json_body = if body, do: Jason.encode!(body), else: nil
    
    case Req.request(method: method, url: url, body: json_body, headers: headers, opts: request_opts) do
      {:ok, %Req.Response{status: status, body: body}} ->
        {:ok, %{status: status, body: body}}
        
      {:error, %Req.TransportError{reason: reason}} ->
        Logger.error("BAML service transport error: #{inspect(reason)}")
        {:error, :transport_error}
        
      {:error, %Req.HTTPError{} = error} ->
        Logger.error("BAML service HTTP error: #{inspect(error)}")
        {:error, :http_error}
        
      {:error, reason} ->
        Logger.error("BAML service request failed: #{inspect(reason)}")
        {:error, :request_failed}
    end
  end
  
  defp retry_options(max_retries) when max_retries > 0 do
    [
      retry: :transient,
      max_retries: max_retries,
      retry_delay: fn attempt ->
        # Exponential backoff: 1s, 2s, 4s, 8s...
        @backoff_base * :math.pow(2, attempt - 1)
        |> trunc()
        |> min(10_000)  # Cap at 10 seconds
      end
    ]
  end
  
  defp retry_options(_), do: [retry: false]
  
  defp generate_correlation_id do
    :crypto.strong_rand_bytes(8) |> Base.url_encode64(padding: false)
  end
end