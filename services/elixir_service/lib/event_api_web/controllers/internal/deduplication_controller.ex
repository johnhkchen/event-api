defmodule EventAPIWeb.Internal.DeduplicationController do
  @moduledoc """
  Controller for entity deduplication endpoints.
  
  These endpoints provide AI-powered deduplication services for speakers,
  companies, and events using fuzzy matching and confidence scoring.
  """
  
  use EventAPIWeb, :controller
  require Logger
  
  alias EventAPI.Processing.DeduplicationService
  
  action_fallback EventAPIWeb.FallbackController

  @valid_entity_types ["speakers", "companies", "events"]

  @doc """
  Deduplicate entities based on entity type and input data.
  
  ## Parameters
  - entity_type: Type of entity to deduplicate ("speakers", "companies", "events")
  - data: List of entities to deduplicate (for direct processing)
  - batch_size: Size of batches for batch processing (optional)
  - batch_opts: Options for batch processing (optional)
  
  ## Response
  Returns deduplication results with auto-merged items, manual review items,
  and processing statistics.
  """
  def deduplicate(conn, params) do
    with {:ok, entity_type} <- validate_entity_type(params),
         {:ok, processed_params} <- validate_and_process_params(params, entity_type) do
      
      Logger.info("Processing deduplication for entity_type: #{entity_type}")
      
      case call_deduplication_service(entity_type, processed_params) do
        {:ok, result} ->
          conn
          |> put_status(:accepted)
          |> json(%{
            success: true,
            data: result
          })
          
        {:error, reason} ->
          Logger.error("Deduplication failed for #{entity_type}: #{inspect(reason)}")
          {:error, reason}
      end
    end
  end

  # Private helper functions

  defp validate_entity_type(%{"entity_type" => entity_type}) when entity_type in @valid_entity_types do
    {:ok, entity_type}
  end

  defp validate_entity_type(%{"entity_type" => invalid_type}) do
    Logger.warning("Invalid entity type received: #{invalid_type}")
    {:error, :invalid_params}
  end

  defp validate_entity_type(_params) do
    Logger.warning("Missing entity_type parameter")
    {:error, :invalid_params}
  end

  defp validate_and_process_params(%{"data" => data} = _params, _entity_type) when is_list(data) do
    # Direct data processing
    {:ok, %{data: data, processing_type: :direct}}
  end

  defp validate_and_process_params(%{"batch_size" => batch_size} = params, _entity_type) 
       when is_integer(batch_size) and batch_size > 0 do
    # Batch processing
    batch_opts = %{
      batch_size: batch_size,
      confidence_threshold: Map.get(params["batch_opts"] || %{}, "confidence_threshold", 0.8),
      auto_merge_enabled: Map.get(params["batch_opts"] || %{}, "auto_merge_enabled", true)
    }
    {:ok, %{batch_opts: batch_opts, processing_type: :batch}}
  end

  defp validate_and_process_params(params, _entity_type) do
    Logger.warning("Invalid parameters for deduplication: #{inspect(params)}")
    {:error, :invalid_params}
  end

  defp call_deduplication_service(entity_type, %{processing_type: :direct, data: data}) do
    case entity_type do
      "speakers" -> DeduplicationService.deduplicate_speakers(data)
      "companies" -> DeduplicationService.deduplicate_companies(data)
      "events" -> DeduplicationService.deduplicate_events(data)
    end
  end

  defp call_deduplication_service(entity_type, %{processing_type: :batch, batch_opts: batch_opts}) do
    DeduplicationService.batch_deduplicate(entity_type, batch_opts)
  end
end