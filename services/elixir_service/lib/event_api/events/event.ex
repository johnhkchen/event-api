defmodule EventAPI.Events.Event do
  @moduledoc """
  Schema for events table.
  
  Core event data with AI processing support including vector embeddings,
  extracted data, and data quality scoring.
  """

  use Ecto.Schema
  import Ecto.Changeset
  import Ecto.Query

  alias EventAPI.Types.Vector
  alias EventAPI.Events.{Speaker, Company, Topic, EventSpeaker, EventCompany, EventTopic}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "events" do
    field :name, :string
    field :description, :string
    field :date, :date
    field :location, :string
    field :luma_url, :string
    field :raw_html, :string
    field :extracted_data, :map
    field :embedding, Vector
    field :data_quality_score, :integer, default: 0
    field :scraped_at, :utc_datetime
    field :processed_at, :utc_datetime
    timestamps(type: :utc_datetime, updated_at: false)

    # Many-to-many associations
    many_to_many :speakers, Speaker,
      join_through: EventSpeaker,
      join_keys: [event_id: :id, speaker_id: :id]

    many_to_many :companies, Company,
      join_through: EventCompany,
      join_keys: [event_id: :id, company_id: :id]

    many_to_many :topics, Topic,
      join_through: EventTopic,
      join_keys: [event_id: :id, topic_id: :id]

    # Junction table associations for detailed queries
    has_many :event_speakers, EventSpeaker, foreign_key: :event_id
    has_many :event_companies, EventCompany, foreign_key: :event_id
    has_many :event_topics, EventTopic, foreign_key: :event_id
  end

  @doc """
  Changeset for creating and updating events.
  """
  def changeset(event, attrs) do
    event
    |> cast(attrs, [
      :name, :description, :date, :location, :luma_url, :raw_html,
      :extracted_data, :embedding, :data_quality_score, 
      :scraped_at, :processed_at
    ])
    |> validate_required([:name])
    |> validate_length(:name, min: 1, max: 500)
    |> validate_length(:description, max: 5000)
    |> validate_length(:location, max: 200)
    |> validate_url(:luma_url)
    |> validate_data_quality_score()
    |> validate_date()
    |> validate_embedding()
    |> unique_constraint(:luma_url)
  end

  @doc """
  Changeset specifically for scraping operations.
  """
  def scraping_changeset(event, attrs) do
    event
    |> cast(attrs, [:name, :description, :date, :location, :luma_url, :raw_html, :scraped_at])
    |> validate_required([:name, :luma_url, :raw_html])
    |> validate_url(:luma_url)
    |> unique_constraint(:luma_url)
    |> put_scraped_at()
  end

  @doc """
  Changeset for AI processing results.
  """
  def processing_changeset(event, attrs) do
    event
    |> cast(attrs, [:extracted_data, :embedding, :data_quality_score, :processed_at])
    |> validate_embedding()
    |> validate_data_quality_score()
    |> put_processed_at()
  end

  # Private validation functions

  defp validate_url(changeset, field) do
    validate_change(changeset, field, fn field, value ->
      case value do
        nil -> []
        "" -> []
        url when is_binary(url) ->
          if String.match?(url, ~r/^https?:\/\/.*lu\.ma\/.*/) do
            []
          else
            [{field, "must be a valid lu.ma URL"}]
          end
        _ -> [{field, "must be a string"}]
      end
    end)
  end

  defp validate_data_quality_score(changeset) do
    validate_change(changeset, :data_quality_score, fn field, value ->
      case value do
        score when is_integer(score) and score >= 0 and score <= 100 -> []
        _ -> [{field, "must be an integer between 0 and 100"}]
      end
    end)
  end

  defp validate_date(changeset) do
    validate_change(changeset, :date, fn field, value ->
      case value do
        %Date{} = date ->
          if Date.compare(date, ~D[1900-01-01]) == :lt do
            [{field, "cannot be before 1900-01-01"}]
          else
            []
          end
        nil -> []
        _ -> [{field, "must be a valid date"}]
      end
    end)
  end

  defp validate_embedding(changeset) do
    validate_change(changeset, :embedding, fn field, value ->
      case Vector.validate_openai_embedding(value) do
        {:ok, _} -> []
        {:error, message} -> [{field, message}]
      end
    end)
  end

  defp put_scraped_at(changeset) do
    case get_field(changeset, :scraped_at) do
      nil -> put_change(changeset, :scraped_at, DateTime.utc_now())
      _ -> changeset
    end
  end

  defp put_processed_at(changeset) do
    case get_field(changeset, :processed_at) do
      nil -> put_change(changeset, :processed_at, DateTime.utc_now())
      _ -> changeset
    end
  end

  @doc """
  Helper function to calculate and update data quality score.
  
  Scores based on completeness of fields:
  - Name: 20 points (required)
  - Description: 15 points
  - Date: 15 points  
  - Location: 10 points
  - Raw HTML: 10 points
  - Extracted data: 15 points
  - Embedding: 15 points
  """
  def calculate_data_quality_score(event) do
    score = 0

    score = if event.name && String.trim(event.name) != "", do: score + 20, else: score
    score = if event.description && String.trim(event.description) != "", do: score + 15, else: score
    score = if event.date, do: score + 15, else: score
    score = if event.location && String.trim(event.location) != "", do: score + 10, else: score
    score = if event.raw_html && String.trim(event.raw_html) != "", do: score + 10, else: score
    score = if event.extracted_data && map_size(event.extracted_data) > 0, do: score + 15, else: score
    score = if event.embedding && is_list(event.embedding) && length(event.embedding) == 1536, do: score + 15, else: score

    min(score, 100)
  end

  @doc """
  Query helper to find events by vector similarity.
  Returns a query that can be further refined.
  """
  def by_similarity_query(query_embedding, limit \\ 10) do
    from e in __MODULE__,
      where: not is_nil(e.embedding),
      order_by: fragment("embedding <=> ?", ^query_embedding),
      limit: ^limit,
      select: %{event: e, distance: fragment("embedding <=> ?", ^query_embedding)}
  end

  @doc """
  Query helper for full-text search.
  """
  def by_text_search_query(search_term) do
    search_query = String.replace(search_term, ~r/\s+/, " & ")
    
    from e in __MODULE__,
      where: fragment("to_tsvector('english', coalesce(?, '') || ' ' || coalesce(?, '') || ' ' || coalesce(?, '')) @@ plainto_tsquery('english', ?)",
                     e.name, e.description, e.location, ^search_query),
      order_by: fragment("ts_rank(to_tsvector('english', coalesce(?, '') || ' ' || coalesce(?, '') || ' ' || coalesce(?, '')), plainto_tsquery('english', ?)) DESC",
                        e.name, e.description, e.location, ^search_query)
  end

  @doc """
  Query helper for filtering by date range.
  """
  def by_date_range_query(start_date, end_date) do
    from e in __MODULE__,
      where: e.date >= ^start_date and e.date <= ^end_date,
      order_by: e.date
  end

  @doc """
  Query helper for filtering by data quality score.
  """
  def by_quality_score_query(min_score \\ 50) do
    from e in __MODULE__,
      where: e.data_quality_score >= ^min_score,
      order_by: [desc: e.data_quality_score]
  end
end