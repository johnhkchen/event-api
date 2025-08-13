defmodule EventAPI.Events.Speaker do
  @moduledoc """
  Schema for speakers table.
  
  Handles speaker data with AI-powered deduplication support using
  normalized names and confidence scoring.
  """

  use Ecto.Schema
  import Ecto.Changeset
  import Ecto.Query

  alias EventAPI.Events.{Event, EventSpeaker}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "speakers" do
    field :name, :string
    field :normalized_name, :string
    field :company, :string
    field :bio, :string
    field :confidence_score, :float, default: 0.0
    timestamps(type: :utc_datetime, updated_at: false)

    # Many-to-many associations
    many_to_many :events, Event,
      join_through: EventSpeaker,
      join_keys: [speaker_id: :id, event_id: :id]

    # Junction table association for detailed queries
    has_many :event_speakers, EventSpeaker, foreign_key: :speaker_id
  end

  @doc """
  Changeset for creating and updating speakers.
  """
  def changeset(speaker, attrs) do
    speaker
    |> cast(attrs, [:name, :company, :bio, :confidence_score])
    |> validate_required([:name])
    |> validate_length(:name, min: 1, max: 200)
    |> validate_length(:company, max: 200)
    |> validate_length(:bio, max: 2000)
    |> validate_confidence_score()
    |> put_normalized_name()
    |> validate_non_empty_name()
  end

  @doc """
  Changeset for AI extraction/deduplication results.
  """
  def deduplication_changeset(speaker, attrs) do
    speaker
    |> cast(attrs, [:name, :normalized_name, :company, :bio, :confidence_score])
    |> validate_required([:name, :normalized_name])
    |> validate_confidence_score()
    |> validate_non_empty_name()
  end

  # Private validation functions

  defp validate_confidence_score(changeset) do
    validate_change(changeset, :confidence_score, fn field, value ->
      case value do
        score when is_float(score) and score >= 0.0 and score <= 1.0 -> []
        score when is_integer(score) and score >= 0 and score <= 1 -> []
        _ -> [{field, "must be a float between 0.0 and 1.0"}]
      end
    end)
  end

  defp validate_non_empty_name(changeset) do
    validate_change(changeset, :name, fn field, value ->
      case value do
        name when is_binary(name) ->
          if String.trim(name) == "" do
            [{field, "cannot be empty or whitespace only"}]
          else
            []
          end
        _ -> [{field, "must be a string"}]
      end
    end)
  end

  defp put_normalized_name(changeset) do
    case get_field(changeset, :name) do
      nil -> changeset
      name when is_binary(name) ->
        normalized = normalize_name(name)
        put_change(changeset, :normalized_name, normalized)
    end
  end

  @doc """
  Normalize a speaker name for deduplication.
  
  Normalization rules:
  - Convert to lowercase
  - Remove extra whitespace
  - Remove common prefixes (Dr., Mr., Ms., etc.)
  - Remove punctuation except hyphens and apostrophes
  - Standardize name order
  """
  def normalize_name(name) when is_binary(name) do
    name
    |> String.trim()
    |> String.downcase()
    |> remove_titles()
    |> normalize_punctuation()
    |> normalize_whitespace()
    |> String.trim()
  end

  # Private normalization helpers

  defp remove_titles(name) do
    titles = ~w[dr dr. mr mr. ms ms. mrs mrs. prof prof. professor]
    
    Enum.reduce(titles, name, fn title, acc ->
      String.replace(acc, ~r/^#{title}\s+/i, "")
    end)
  end

  defp normalize_punctuation(name) do
    name
    |> String.replace(~r/[^\w\s'-]/, "")
    |> String.replace(~r/['']/, "'")
  end

  defp normalize_whitespace(name) do
    String.replace(name, ~r/\s+/, " ")
  end

  @doc """
  Calculate similarity score between two normalized names.
  Uses Jaro-Winkler distance for fuzzy matching.
  """
  def name_similarity(name1, name2) when is_binary(name1) and is_binary(name2) do
    jaro_winkler_distance(name1, name2)
  end

  # Basic Jaro-Winkler implementation for name matching
  defp jaro_winkler_distance(s1, s2) when s1 == s2, do: 1.0
  
  defp jaro_winkler_distance(s1, s2) do
    jaro_distance = jaro_distance(s1, s2)
    
    if jaro_distance < 0.7 do
      jaro_distance
    else
      # Apply Winkler prefix bonus
      prefix_length = common_prefix_length(s1, s2, 0, 4)
      jaro_distance + (0.1 * prefix_length * (1 - jaro_distance))
    end
  end

  defp jaro_distance(s1, s2) do
    len1 = String.length(s1)
    len2 = String.length(s2)

    if len1 == 0 and len2 == 0 do
      1.0
    else
      match_window = max(len1, len2) |> div(2) |> Kernel.-(1) |> max(0)
      
      {matches1, matches2} = find_matches(s1, s2, match_window)
      match_count = Enum.sum(matches1)
      
      if match_count == 0 do
        0.0
      else
        transpositions = count_transpositions(s1, s2, matches1, matches2)
        (match_count / len1 + match_count / len2 + (match_count - transpositions / 2) / match_count) / 3
      end
    end
  end

  defp common_prefix_length(s1, s2, current, max) when current >= max do
    current
  end

  defp common_prefix_length(s1, s2, current, max) do
    if current < String.length(s1) and current < String.length(s2) and
       String.at(s1, current) == String.at(s2, current) do
      common_prefix_length(s1, s2, current + 1, max)
    else
      current
    end
  end

  defp find_matches(s1, s2, match_window) do
    len1 = String.length(s1)
    len2 = String.length(s2)
    
    matches1 = List.duplicate(false, len1)
    matches2 = List.duplicate(false, len2)
    
    {matches1, matches2} = 
      Enum.reduce(0..(len1 - 1), {matches1, matches2}, fn i, {m1, m2} ->
        start_pos = max(0, i - match_window)
        end_pos = min(i + match_window + 1, len2)
        
        char1 = String.at(s1, i)
        
        case find_char_in_range(s2, char1, start_pos, end_pos, m2) do
          {true, j, new_m2} ->
            {List.replace_at(m1, i, true), new_m2}
          {false, _, _} ->
            {m1, m2}
        end
      end)
      
    {matches1, matches2}
  end

  defp find_char_in_range(_s2, _char, start_pos, end_pos, matches2) when start_pos >= end_pos do
    {false, -1, matches2}
  end

  defp find_char_in_range(s2, char, start_pos, end_pos, matches2) do
    Enum.reduce_while(start_pos..(end_pos - 1), {false, -1, matches2}, fn j, {found, _, m2} ->
      if not Enum.at(m2, j) and String.at(s2, j) == char do
        {:halt, {true, j, List.replace_at(m2, j, true)}}
      else
        {:cont, {found, -1, m2}}
      end
    end)
  end

  defp count_transpositions(s1, s2, matches1, matches2) do
    matched_chars1 = extract_matched_chars(s1, matches1)
    matched_chars2 = extract_matched_chars(s2, matches2)
    
    Enum.zip(matched_chars1, matched_chars2)
    |> Enum.count(fn {c1, c2} -> c1 != c2 end)
  end

  defp extract_matched_chars(s, matches) do
    Enum.with_index(matches)
    |> Enum.filter(fn {matched, _} -> matched end)
    |> Enum.map(fn {_, i} -> String.at(s, i) end)
  end

  @doc """
  Query helper to find similar speakers by normalized name.
  """
  def similar_names_query(normalized_name, threshold \\ 0.8) do
    # This would use a similarity function in a real database
    # For now, we'll use exact match and prefix matching
    from s in __MODULE__,
      where: s.normalized_name == ^normalized_name
      or like(s.normalized_name, ^"#{String.slice(normalized_name, 0..2)}%"),
      order_by: [desc: s.confidence_score]
  end

  @doc """
  Query helper to find speakers by company.
  """
  def by_company_query(company) do
    from s in __MODULE__,
      where: ilike(s.company, ^"%#{company}%"),
      order_by: [desc: s.confidence_score]
  end

  @doc """
  Query helper for high-confidence speakers.
  """
  def high_confidence_query(min_confidence \\ 0.7) do
    from s in __MODULE__,
      where: s.confidence_score >= ^min_confidence,
      order_by: [desc: s.confidence_score]
  end
end