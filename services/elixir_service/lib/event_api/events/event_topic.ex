defmodule EventAPI.Events.EventTopic do
  @moduledoc """
  Schema for event_topics junction table.
  
  Handles the many-to-many relationship between events and topics
  with relevance scoring for AI-powered categorization.
  """

  use Ecto.Schema
  import Ecto.Changeset
  import Ecto.Query

  alias EventAPI.Events.{Event, Topic}

  @primary_key false

  schema "event_topics" do
    belongs_to :event, Event, foreign_key: :event_id, type: :binary_id
    belongs_to :topic, Topic, foreign_key: :topic_id, type: :binary_id
    field :relevance_score, :float, default: 0.0
    timestamps(type: :utc_datetime, updated_at: false)
  end

  @doc """
  Changeset for creating event-topic associations.
  """
  def changeset(event_topic, attrs) do
    event_topic
    |> cast(attrs, [:event_id, :topic_id, :relevance_score])
    |> validate_required([:event_id, :topic_id])
    |> validate_relevance_score()
    |> assoc_constraint(:event)
    |> assoc_constraint(:topic)
    |> unique_constraint([:event_id, :topic_id],
         name: :event_topics_pkey,
         message: "topic already associated with this event")
  end

  @doc """
  Changeset for AI extraction results with relevance scoring.
  """
  def extraction_changeset(event_topic, attrs) do
    event_topic
    |> cast(attrs, [:event_id, :topic_id, :relevance_score])
    |> validate_required([:event_id, :topic_id, :relevance_score])
    |> validate_relevance_score()
    |> assoc_constraint(:event)
    |> assoc_constraint(:topic)
  end

  # Private validation functions

  defp validate_relevance_score(changeset) do
    validate_change(changeset, :relevance_score, fn field, value ->
      case value do
        score when is_float(score) and score >= 0.0 and score <= 1.0 -> []
        score when is_integer(score) and score >= 0 and score <= 1 -> []
        _ -> [{field, "must be a float between 0.0 and 1.0"}]
      end
    end)
  end

  @doc """
  Create association between event and topic with relevance score.
  """
  def create_association(event_id, topic_id, relevance_score \\ 0.5) do
    attrs = %{
      event_id: event_id,
      topic_id: topic_id,
      relevance_score: relevance_score
    }
    
    %__MODULE__{}
    |> changeset(attrs)
    |> EventAPI.Repo.insert(on_conflict: :replace_all, conflict_target: [:event_id, :topic_id])
  end

  @doc """
  Create multiple topic associations for an event from a list.
  """
  def create_associations(event_id, topic_scores) when is_list(topic_scores) do
    associations = Enum.map(topic_scores, fn {topic_id, score} ->
      %{
        event_id: event_id,
        topic_id: topic_id,
        relevance_score: score,
        created_at: DateTime.utc_now()
      }
    end)

    EventAPI.Repo.insert_all(__MODULE__, associations,
      on_conflict: :replace_all,
      conflict_target: [:event_id, :topic_id])
  end

  @doc """
  Query helper to find topics for an event with relevance scores.
  """
  def topics_for_event_query(event_id, min_relevance \\ 0.3) do
    from et in __MODULE__,
      join: t in assoc(et, :topic),
      where: et.event_id == ^event_id and et.relevance_score >= ^min_relevance,
      order_by: [desc: et.relevance_score, asc: t.name],
      select: %{
        topic: t,
        relevance_score: et.relevance_score
      }
  end

  @doc """
  Query helper to find events for a topic with relevance scores.
  """
  def events_for_topic_query(topic_id, min_relevance \\ 0.3) do
    from et in __MODULE__,
      join: e in assoc(et, :event),
      where: et.topic_id == ^topic_id and et.relevance_score >= ^min_relevance,
      order_by: [desc: et.relevance_score, desc: e.date],
      select: %{
        event: e,
        relevance_score: et.relevance_score
      }
  end

  @doc """
  Query helper to find highly relevant topic associations.
  """
  def high_relevance_query(min_relevance \\ 0.7) do
    from et in __MODULE__,
      where: et.relevance_score >= ^min_relevance,
      order_by: [desc: et.relevance_score]
  end

  @doc """
  Query helper to find events by topic category with relevance filtering.
  """
  def events_by_topic_category_query(category, min_relevance \\ 0.5) do
    from et in __MODULE__,
      join: t in assoc(et, :topic),
      join: e in assoc(et, :event),
      where: t.category == ^category and et.relevance_score >= ^min_relevance,
      order_by: [desc: et.relevance_score, desc: e.date],
      select: %{
        event: e,
        topic: t,
        relevance_score: et.relevance_score
      }
  end

  @doc """
  Query helper to find similar events based on shared topics.
  """
  def similar_events_query(event_id, min_shared_topics \\ 2, min_relevance \\ 0.5) do
    # Find topics for the given event
    event_topics_subquery = from et in __MODULE__,
      where: et.event_id == ^event_id and et.relevance_score >= ^min_relevance,
      select: et.topic_id

    # Find other events sharing those topics
    from et in __MODULE__,
      join: e in assoc(et, :event),
      where: et.topic_id in subquery(event_topics_subquery) and
             et.event_id != ^event_id and
             et.relevance_score >= ^min_relevance,
      group_by: [e.id, e.name, e.date, e.location],
      having: count(et.topic_id) >= ^min_shared_topics,
      order_by: [desc: count(et.topic_id), desc: avg(et.relevance_score)],
      select: %{
        event: e,
        shared_topic_count: count(et.topic_id),
        avg_relevance: avg(et.relevance_score)
      }
  end

  @doc """
  Query helper to get topic statistics for an event.
  """
  def event_topic_stats_query(event_id) do
    from et in __MODULE__,
      join: t in assoc(et, :topic),
      where: et.event_id == ^event_id,
      group_by: t.category,
      select: %{
        category: t.category,
        count: count(et.topic_id),
        avg_relevance: avg(et.relevance_score),
        max_relevance: max(et.relevance_score)
      }
  end

  @doc """
  Query helper to find most popular topics across all events.
  """
  def popular_topics_query(limit \\ 20, min_relevance \\ 0.5) do
    from et in __MODULE__,
      join: t in assoc(et, :topic),
      where: et.relevance_score >= ^min_relevance,
      group_by: [t.id, t.name, t.category],
      order_by: [desc: count(et.event_id), desc: avg(et.relevance_score)],
      limit: ^limit,
      select: %{
        topic: t,
        event_count: count(et.event_id),
        avg_relevance: avg(et.relevance_score)
      }
  end

  @doc """
  Query helper to find trending topics in a date range.
  """
  def trending_topics_query(start_date, end_date, limit \\ 10, min_relevance \\ 0.5) do
    from et in __MODULE__,
      join: t in assoc(et, :topic),
      join: e in assoc(et, :event),
      where: e.date >= ^start_date and e.date <= ^end_date and
             et.relevance_score >= ^min_relevance,
      group_by: [t.id, t.name, t.category],
      order_by: [desc: count(et.event_id), desc: avg(et.relevance_score)],
      limit: ^limit,
      select: %{
        topic: t,
        event_count: count(et.event_id),
        avg_relevance: avg(et.relevance_score)
      }
  end

  @doc """
  Query helper to find topics by relevance threshold.
  """
  def by_relevance_threshold_query(min_relevance, max_relevance \\ 1.0) do
    from et in __MODULE__,
      where: et.relevance_score >= ^min_relevance and et.relevance_score <= ^max_relevance,
      order_by: [desc: et.relevance_score]
  end

  @doc """
  Query helper to get topic distribution for events.
  """
  def topic_distribution_query do
    from et in __MODULE__,
      join: t in assoc(et, :topic),
      group_by: t.category,
      order_by: [desc: count(et.event_id)],
      select: %{
        category: t.category,
        event_count: count(et.event_id),
        avg_relevance: avg(et.relevance_score),
        topic_count: count(fragment("DISTINCT ?", t.id))
      }
  end

  @doc """
  Query helper to find low-relevance associations for cleanup.
  """
  def low_relevance_query(max_relevance \\ 0.3) do
    from et in __MODULE__,
      where: et.relevance_score <= ^max_relevance,
      order_by: [asc: et.relevance_score]
  end

  @doc """
  Calculate topic relevance score based on multiple factors.
  
  Factors considered:
  - Text frequency in event name/description
  - Topic category alignment
  - Manual curation boost
  """
  def calculate_relevance_score(event, topic, text_frequency \\ 0.0, manual_boost \\ 0.0) do
    base_score = text_frequency * 0.6  # 60% from text analysis
    category_score = category_alignment_score(event, topic) * 0.3  # 30% from category alignment
    manual_score = manual_boost * 0.1  # 10% from manual curation
    
    total_score = base_score + category_score + manual_score
    min(max(total_score, 0.0), 1.0)
  end

  defp category_alignment_score(_event, %{category: nil}), do: 0.0
  defp category_alignment_score(_event, %{category: "technology"}), do: 0.8  # Tech events are common
  defp category_alignment_score(_event, %{category: "industry"}), do: 0.7   # Industry alignment
  defp category_alignment_score(_event, %{category: "format"}), do: 0.6     # Format topics
end