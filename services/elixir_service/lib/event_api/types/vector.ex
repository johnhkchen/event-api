defmodule EventAPI.Types.Vector do
  @moduledoc """
  Custom Ecto type for pgvector vector fields.
  
  Handles conversion between Elixir lists of floats and PostgreSQL vector type.
  Designed for 1536-dimensional OpenAI embeddings.
  """

  use Ecto.Type

  @impl true
  def type, do: :vector

  @impl true
  def cast(value) when is_list(value) do
    # Validate that all elements are numbers
    if Enum.all?(value, &is_number/1) do
      {:ok, Enum.map(value, &(&1 + 0.0))}  # Convert to floats
    else
      {:error, message: "vector must contain only numbers"}
    end
  end

  def cast(nil), do: {:ok, nil}
  def cast(_), do: :error

  @impl true
  def load(value) when is_binary(value) do
    # Parse pgvector format: "[0.1,0.2,0.3]"
    case parse_vector_string(value) do
      {:ok, vector} -> {:ok, vector}
      {:error, _} -> :error
    end
  end

  def load(nil), do: {:ok, nil}
  def load(_), do: :error

  @impl true
  def dump(value) when is_list(value) do
    # Convert list to pgvector format: "[0.1,0.2,0.3]"
    vector_string = 
      value
      |> Enum.map(&Float.to_string/1)
      |> Enum.join(",")
      |> then(&("[#{&1}]"))
    
    {:ok, vector_string}
  end

  def dump(nil), do: {:ok, nil}
  def dump(_), do: :error

  @impl true
  def equal?(left, right) do
    left == right
  end

  @impl true
  def embed_as(_format), do: :self

  # Helper functions

  defp parse_vector_string("[" <> rest) do
    case String.split(rest, "]", parts: 2) do
      [vector_content, _] ->
        case parse_float_list(vector_content) do
          {:ok, floats} -> {:ok, floats}
          {:error, _} -> {:error, "invalid vector format"}
        end
      
      _ ->
        {:error, "malformed vector string"}
    end
  end

  defp parse_vector_string(_), do: {:error, "vector must start with ["}

  defp parse_float_list(""), do: {:ok, []}
  
  defp parse_float_list(content) do
    content
    |> String.split(",")
    |> Enum.map(&String.trim/1)
    |> Enum.reduce_while({:ok, []}, fn str, {:ok, acc} ->
      case Float.parse(str) do
        {float, ""} -> {:cont, {:ok, [float | acc]}}
        _ -> {:halt, {:error, "invalid float: #{str}"}}
      end
    end)
    |> case do
      {:ok, floats} -> {:ok, Enum.reverse(floats)}
      error -> error
    end
  end

  @doc """
  Calculate cosine similarity between two vectors.
  Used for semantic search operations.
  """
  def cosine_similarity(vector1, vector2) when length(vector1) == length(vector2) do
    dot_product = 
      vector1
      |> Enum.zip(vector2)
      |> Enum.map(fn {a, b} -> a * b end)
      |> Enum.sum()

    magnitude1 = vector_magnitude(vector1)
    magnitude2 = vector_magnitude(vector2)

    if magnitude1 > 0 and magnitude2 > 0 do
      dot_product / (magnitude1 * magnitude2)
    else
      0.0
    end
  end

  def cosine_similarity(_, _), do: {:error, "vectors must have same dimensions"}

  @doc """
  Calculate the magnitude (L2 norm) of a vector.
  """
  def vector_magnitude(vector) do
    vector
    |> Enum.map(&(&1 * &1))
    |> Enum.sum()
    |> :math.sqrt()
  end

  @doc """
  Normalize a vector to unit length.
  """
  def normalize(vector) do
    magnitude = vector_magnitude(vector)
    
    if magnitude > 0 do
      Enum.map(vector, &(&1 / magnitude))
    else
      vector
    end
  end

  @doc """
  Validate vector dimensions for OpenAI embeddings.
  """
  def validate_openai_embedding(vector) when is_list(vector) do
    case length(vector) do
      1536 -> {:ok, vector}
      actual -> {:error, "OpenAI embedding must have 1536 dimensions, got #{actual}"}
    end
  end

  def validate_openai_embedding(_), do: {:error, "embedding must be a list"}
end