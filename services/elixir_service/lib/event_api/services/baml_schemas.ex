defmodule EventAPI.Services.BAMLSchemas do
  @moduledoc """
  Validation schemas for BAML service requests and responses using Ecto changesets.
  """
  
  import Ecto.Changeset
  
  @doc """
  Validates an HTML extraction request.
  
  ## Examples
  
      iex> EventAPI.Services.BAMLSchemas.validate_extract_request(%{html: "<html>test</html>"})
      {:ok, %{html: "<html>test</html>", correlation_id: "abc123"}}
      
      iex> EventAPI.Services.BAMLSchemas.validate_extract_request(%{})
      {:error, %Ecto.Changeset{}}
  """
  def validate_extract_request(params) do
    types = %{
      html: :string,
      correlation_id: :string,
      options: :map
    }
    
    {%{}, types}
    |> cast(params, [:html, :correlation_id, :options])
    |> validate_required([:html])
    |> validate_length(:html, min: 10, max: 1_000_000)
    |> validate_format(:correlation_id, ~r/^[a-zA-Z0-9_-]+$/)
    |> apply_action(:extract_request)
  end
  
  @doc """
  Validates a batch extraction request.
  
  ## Examples
  
      iex> EventAPI.Services.BAMLSchemas.validate_batch_request(%{documents: [%{id: 1, html: "<html>test</html>"}]})
      {:ok, %{documents: [%{id: 1, html: "<html>test</html>"}], correlation_id: "abc123"}}
  """
  def validate_batch_request(params) do
    types = %{
      documents: {:array, :map},
      correlation_id: :string,
      options: :map
    }
    
    {%{}, types}
    |> cast(params, [:documents, :correlation_id, :options])
    |> validate_required([:documents])
    |> validate_length(:documents, min: 1, max: 100)
    |> validate_batch_documents()
    |> validate_format(:correlation_id, ~r/^[a-zA-Z0-9_-]+$/)
    |> apply_action(:batch_request)
  end
  
  @doc """
  Validates an embedding generation request.
  
  ## Examples
  
      iex> EventAPI.Services.BAMLSchemas.validate_embedding_request(%{text: "Machine learning conference"})
      {:ok, %{text: "Machine learning conference", correlation_id: "abc123"}}
  """
  def validate_embedding_request(params) do
    types = %{
      text: :string,
      correlation_id: :string,
      model: :string
    }
    
    {%{}, types}
    |> cast(params, [:text, :correlation_id, :model])
    |> validate_required([:text])
    |> validate_length(:text, min: 1, max: 100_000)
    |> validate_format(:correlation_id, ~r/^[a-zA-Z0-9_-]+$/)
    |> apply_action(:embedding_request)
  end
  
  @doc """
  Validates a successful extraction response.
  
  ## Examples
  
      iex> response = %{"success" => true, "data" => %{"title" => "Test Event", "confidence" => 0.95}}
      iex> EventAPI.Services.BAMLSchemas.validate_extract_response(response)
      {:ok, %{success: true, data: %{title: "Test Event", confidence: 0.95}}}
  """
  def validate_extract_response(params) do
    types = %{
      success: :boolean,
      data: :map,
      error: :string,
      correlation_id: :string,
      processing_time_ms: :integer
    }
    
    {%{}, types}
    |> cast(params, [:success, :data, :error, :correlation_id, :processing_time_ms])
    |> validate_required([:success])
    |> validate_response_data()
    |> apply_action(:extract_response)
  end
  
  @doc """
  Validates a batch extraction response.
  """
  def validate_batch_response(params) do
    types = %{
      success: :boolean,
      results: {:array, :map},
      error: :string,
      correlation_id: :string,
      processing_time_ms: :integer,
      processed_count: :integer
    }
    
    {%{}, types}
    |> cast(params, [:success, :results, :error, :correlation_id, :processing_time_ms, :processed_count])
    |> validate_required([:success])
    |> validate_batch_results()
    |> apply_action(:batch_response)
  end
  
  @doc """
  Validates an embedding response.
  """
  def validate_embedding_response(params) do
    types = %{
      success: :boolean,
      embedding: {:array, :float},
      error: :string,
      correlation_id: :string,
      dimensions: :integer
    }
    
    {%{}, types}
    |> cast(params, [:success, :embedding, :error, :correlation_id, :dimensions])
    |> validate_required([:success])
    |> validate_embedding_data()
    |> apply_action(:embedding_response)
  end
  
  # Private validation helpers
  
  defp validate_batch_documents(changeset) do
    case get_field(changeset, :documents) do
      nil -> changeset
      documents when is_list(documents) ->
        valid_documents? = Enum.all?(documents, &valid_document?/1)
        if valid_documents? do
          changeset
        else
          add_error(changeset, :documents, "contains invalid document structures")
        end
      _ ->
        add_error(changeset, :documents, "must be a list")
    end
  end
  
  defp valid_document?(doc) when is_map(doc) do
    Map.has_key?(doc, "html") or Map.has_key?(doc, :html) and
    Map.has_key?(doc, "id") or Map.has_key?(doc, :id)
  end
  defp valid_document?(_), do: false
  
  defp validate_response_data(changeset) do
    case get_field(changeset, :success) do
      true ->
        case get_field(changeset, :data) do
          nil -> add_error(changeset, :data, "is required when success is true")
          data when is_map(data) -> validate_extracted_data(changeset, data)
          _ -> add_error(changeset, :data, "must be a map")
        end
      false ->
        case get_field(changeset, :error) do
          nil -> add_error(changeset, :error, "is required when success is false")
          error when is_binary(error) -> changeset
          _ -> add_error(changeset, :error, "must be a string")
        end
      nil ->
        changeset
    end
  end
  
  defp validate_extracted_data(changeset, data) do
    required_fields = ["title", "description"]
    missing_fields = Enum.filter(required_fields, &(not Map.has_key?(data, &1)))
    
    if Enum.empty?(missing_fields) do
      changeset
    else
      add_error(changeset, :data, "missing required fields: #{Enum.join(missing_fields, ", ")}")
    end
  end
  
  defp validate_batch_results(changeset) do
    case get_field(changeset, :success) do
      true ->
        case get_field(changeset, :results) do
          nil -> add_error(changeset, :results, "is required when success is true")
          results when is_list(results) -> validate_batch_result_items(changeset, results)
          _ -> add_error(changeset, :results, "must be a list")
        end
      false ->
        validate_error_field(changeset)
      nil ->
        changeset
    end
  end
  
  defp validate_batch_result_items(changeset, results) do
    valid_results? = Enum.all?(results, &valid_batch_result?/1)
    if valid_results? do
      changeset
    else
      add_error(changeset, :results, "contains invalid result structures")
    end
  end
  
  defp valid_batch_result?(result) when is_map(result) do
    has_id? = Map.has_key?(result, "id") or Map.has_key?(result, :id)
    has_success? = Map.has_key?(result, "success") or Map.has_key?(result, :success)
    has_id? and has_success?
  end
  defp valid_batch_result?(_), do: false
  
  defp validate_embedding_data(changeset) do
    case get_field(changeset, :success) do
      true ->
        case get_field(changeset, :embedding) do
          nil -> add_error(changeset, :embedding, "is required when success is true")
          embedding when is_list(embedding) ->
            if Enum.all?(embedding, &is_number/1) do
              put_change(changeset, :dimensions, length(embedding))
            else
              add_error(changeset, :embedding, "must be a list of numbers")
            end
          _ -> add_error(changeset, :embedding, "must be a list")
        end
      false ->
        validate_error_field(changeset)
      nil ->
        changeset
    end
  end
  
  defp validate_error_field(changeset) do
    case get_field(changeset, :error) do
      nil -> add_error(changeset, :error, "is required when success is false")
      error when is_binary(error) -> changeset
      _ -> add_error(changeset, :error, "must be a string")
    end
  end
end