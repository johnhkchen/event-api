defmodule EventAPI.Events.EventSpeaker do
  @moduledoc """
  Schema for event_speakers junction table.
  
  Handles the many-to-many relationship between events and speakers
  with additional metadata including speaker roles and extraction confidence.
  """

  use Ecto.Schema
  import Ecto.Changeset
  import Ecto.Query

  alias EventAPI.Events.{Event, Speaker}

  @primary_key false

  # Valid speaker roles
  @valid_roles ~w[speaker judge host panelist]

  schema "event_speakers" do
    belongs_to :event, Event, foreign_key: :event_id, type: :binary_id
    belongs_to :speaker, Speaker, foreign_key: :speaker_id, type: :binary_id
    field :role, :string
    field :extraction_confidence, :float, default: 0.0
    timestamps(type: :utc_datetime, updated_at: false)
  end

  @doc """
  Changeset for creating event-speaker associations.
  """
  def changeset(event_speaker, attrs) do
    event_speaker
    |> cast(attrs, [:event_id, :speaker_id, :role, :extraction_confidence])
    |> validate_required([:event_id, :speaker_id])
    |> validate_inclusion(:role, @valid_roles)
    |> validate_extraction_confidence()
    |> assoc_constraint(:event)
    |> assoc_constraint(:speaker)
    |> unique_constraint([:event_id, :speaker_id, :role], 
         name: :event_speakers_pkey,
         message: "speaker already has this role for this event")
  end

  @doc """
  Changeset for AI extraction results.
  """
  def extraction_changeset(event_speaker, attrs) do
    event_speaker
    |> cast(attrs, [:event_id, :speaker_id, :role, :extraction_confidence])
    |> validate_required([:event_id, :speaker_id, :role])
    |> validate_inclusion(:role, @valid_roles)
    |> validate_extraction_confidence()
    |> assoc_constraint(:event)
    |> assoc_constraint(:speaker)
  end

  # Private validation functions

  defp validate_extraction_confidence(changeset) do
    validate_change(changeset, :extraction_confidence, fn field, value ->
      case value do
        confidence when is_float(confidence) and confidence >= 0.0 and confidence <= 1.0 -> []
        confidence when is_integer(confidence) and confidence >= 0 and confidence <= 1 -> []
        _ -> [{field, "must be a float between 0.0 and 1.0"}]
      end
    end)
  end

  @doc """
  Get list of valid speaker roles.
  """
  def valid_roles, do: @valid_roles

  @doc """
  Create association between event and speaker with role.
  """
  def create_association(event_id, speaker_id, role, confidence \\ 0.8) do
    attrs = %{
      event_id: event_id,
      speaker_id: speaker_id,
      role: role,
      extraction_confidence: confidence
    }
    
    %__MODULE__{}
    |> changeset(attrs)
    |> EventAPI.Repo.insert(on_conflict: :replace_all, conflict_target: [:event_id, :speaker_id, :role])
  end

  @doc """
  Query helper to find speakers for an event with their roles.
  """
  def speakers_for_event_query(event_id) do
    from es in __MODULE__,
      join: s in assoc(es, :speaker),
      where: es.event_id == ^event_id,
      order_by: [desc: es.extraction_confidence, asc: es.role],
      select: %{
        speaker: s,
        role: es.role,
        confidence: es.extraction_confidence
      }
  end

  @doc """
  Query helper to find events for a speaker with their roles.
  """
  def events_for_speaker_query(speaker_id) do
    from es in __MODULE__,
      join: e in assoc(es, :event),
      where: es.speaker_id == ^speaker_id,
      order_by: [desc: e.date],
      select: %{
        event: e,
        role: es.role,
        confidence: es.extraction_confidence
      }
  end

  @doc """
  Query helper to find associations by role.
  """
  def by_role_query(role) when role in @valid_roles do
    from es in __MODULE__,
      where: es.role == ^role,
      order_by: [desc: es.extraction_confidence]
  end

  @doc """
  Query helper for high-confidence associations.
  """
  def high_confidence_query(min_confidence \\ 0.7) do
    from es in __MODULE__,
      where: es.extraction_confidence >= ^min_confidence,
      order_by: [desc: es.extraction_confidence]
  end

  @doc """
  Query helper to find duplicate speaker associations for cleanup.
  """
  def duplicate_associations_query do
    from es in __MODULE__,
      group_by: [es.event_id, es.speaker_id],
      having: count(es.event_id) > 1,
      select: %{
        event_id: es.event_id,
        speaker_id: es.speaker_id,
        count: count(es.event_id)
      }
  end

  @doc """
  Get speaker statistics for an event.
  """
  def event_speaker_stats_query(event_id) do
    from es in __MODULE__,
      where: es.event_id == ^event_id,
      group_by: es.role,
      select: %{
        role: es.role,
        count: count(es.speaker_id),
        avg_confidence: avg(es.extraction_confidence)
      }
  end

  @doc """
  Get role distribution across all events.
  """
  def role_distribution_query do
    from es in __MODULE__,
      group_by: es.role,
      order_by: [desc: count(es.role)],
      select: %{
        role: es.role,
        count: count(es.role),
        avg_confidence: avg(es.extraction_confidence)
      }
  end
end