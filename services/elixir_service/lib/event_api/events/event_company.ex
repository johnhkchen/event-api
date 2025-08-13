defmodule EventAPI.Events.EventCompany do
  @moduledoc """
  Schema for event_companies junction table.
  
  Handles the many-to-many relationship between events and companies
  with relationship types (host, sponsor, venue, partner).
  """

  use Ecto.Schema
  import Ecto.Changeset
  import Ecto.Query

  alias EventAPI.Events.{Event, Company}

  @primary_key false

  # Valid relationship types
  @valid_relationship_types ~w[host sponsor venue partner]

  schema "event_companies" do
    belongs_to :event, Event, foreign_key: :event_id, type: :binary_id
    belongs_to :company, Company, foreign_key: :company_id, type: :binary_id
    field :relationship_type, :string
    timestamps(type: :utc_datetime, updated_at: false)
  end

  @doc """
  Changeset for creating event-company associations.
  """
  def changeset(event_company, attrs) do
    event_company
    |> cast(attrs, [:event_id, :company_id, :relationship_type])
    |> validate_required([:event_id, :company_id, :relationship_type])
    |> validate_inclusion(:relationship_type, @valid_relationship_types)
    |> assoc_constraint(:event)
    |> assoc_constraint(:company)
    |> unique_constraint([:event_id, :company_id, :relationship_type],
         name: :event_companies_pkey,
         message: "company already has this relationship type for this event")
  end

  @doc """
  Changeset for extraction/processing operations.
  """
  def extraction_changeset(event_company, attrs) do
    event_company
    |> cast(attrs, [:event_id, :company_id, :relationship_type])
    |> validate_required([:event_id, :company_id, :relationship_type])
    |> validate_inclusion(:relationship_type, @valid_relationship_types)
    |> assoc_constraint(:event)
    |> assoc_constraint(:company)
  end

  @doc """
  Get list of valid relationship types.
  """
  def valid_relationship_types, do: @valid_relationship_types

  @doc """
  Create association between event and company with relationship type.
  """
  def create_association(event_id, company_id, relationship_type) do
    attrs = %{
      event_id: event_id,
      company_id: company_id,
      relationship_type: relationship_type
    }
    
    %__MODULE__{}
    |> changeset(attrs)
    |> EventAPI.Repo.insert(on_conflict: :replace_all, conflict_target: [:event_id, :company_id, :relationship_type])
  end

  @doc """
  Query helper to find companies for an event with their relationship types.
  """
  def companies_for_event_query(event_id) do
    from ec in __MODULE__,
      join: c in assoc(ec, :company),
      where: ec.event_id == ^event_id,
      order_by: [asc: ec.relationship_type, asc: c.name],
      select: %{
        company: c,
        relationship_type: ec.relationship_type
      }
  end

  @doc """
  Query helper to find events for a company with relationship types.
  """
  def events_for_company_query(company_id) do
    from ec in __MODULE__,
      join: e in assoc(ec, :event),
      where: ec.company_id == ^company_id,
      order_by: [desc: e.date],
      select: %{
        event: e,
        relationship_type: ec.relationship_type
      }
  end

  @doc """
  Query helper to find associations by relationship type.
  """
  def by_relationship_type_query(relationship_type) when relationship_type in @valid_relationship_types do
    from ec in __MODULE__,
      where: ec.relationship_type == ^relationship_type,
      order_by: ec.created_at
  end

  @doc """
  Query helper to find event hosts (companies with 'host' relationship).
  """
  def event_hosts_query(event_id) do
    from ec in __MODULE__,
      join: c in assoc(ec, :company),
      where: ec.event_id == ^event_id and ec.relationship_type == "host",
      select: c
  end

  @doc """
  Query helper to find event sponsors (companies with 'sponsor' relationship).
  """
  def event_sponsors_query(event_id) do
    from ec in __MODULE__,
      join: c in assoc(ec, :company),
      where: ec.event_id == ^event_id and ec.relationship_type == "sponsor",
      select: c
  end

  @doc """
  Query helper to find event venues (companies with 'venue' relationship).
  """
  def event_venues_query(event_id) do
    from ec in __MODULE__,
      join: c in assoc(ec, :company),
      where: ec.event_id == ^event_id and ec.relationship_type == "venue",
      select: c
  end

  @doc """
  Query helper to find most active hosting companies.
  """
  def top_hosting_companies_query(limit \\ 10) do
    from ec in __MODULE__,
      join: c in assoc(ec, :company),
      where: ec.relationship_type == "host",
      group_by: c.id,
      order_by: [desc: count(ec.event_id)],
      limit: ^limit,
      select: %{
        company: c,
        event_count: count(ec.event_id)
      }
  end

  @doc """
  Query helper to find most active sponsoring companies.
  """
  def top_sponsoring_companies_query(limit \\ 10) do
    from ec in __MODULE__,
      join: c in assoc(ec, :company),
      where: ec.relationship_type == "sponsor",
      group_by: c.id,
      order_by: [desc: count(ec.event_id)],
      limit: ^limit,
      select: %{
        company: c,
        event_count: count(ec.event_id)
      }
  end

  @doc """
  Get company relationship statistics for an event.
  """
  def event_company_stats_query(event_id) do
    from ec in __MODULE__,
      where: ec.event_id == ^event_id,
      group_by: ec.relationship_type,
      select: %{
        relationship_type: ec.relationship_type,
        count: count(ec.company_id)
      }
  end

  @doc """
  Get relationship type distribution across all events.
  """
  def relationship_type_distribution_query do
    from ec in __MODULE__,
      group_by: ec.relationship_type,
      order_by: [desc: count(ec.relationship_type)],
      select: %{
        relationship_type: ec.relationship_type,
        count: count(ec.relationship_type)
      }
  end

  @doc """
  Query helper to find companies involved in events within a date range.
  """
  def companies_in_date_range_query(start_date, end_date, relationship_type \\ nil) do
    query = from ec in __MODULE__,
      join: e in assoc(ec, :event),
      join: c in assoc(ec, :company),
      where: e.date >= ^start_date and e.date <= ^end_date

    query = if relationship_type do
      where(query, [ec], ec.relationship_type == ^relationship_type)
    else
      query
    end

    from [ec, e, c] in query,
      group_by: c.id,
      order_by: [desc: count(ec.event_id)],
      select: %{
        company: c,
        event_count: count(ec.event_id),
        relationship_types: fragment("array_agg(DISTINCT ?)", ec.relationship_type)
      }
  end

  @doc """
  Query helper to find potential duplicate company associations.
  """
  def duplicate_associations_query do
    from ec in __MODULE__,
      group_by: [ec.event_id, ec.company_id],
      having: count(ec.event_id) > 1,
      select: %{
        event_id: ec.event_id,
        company_id: ec.company_id,
        relationship_types: fragment("array_agg(?)", ec.relationship_type),
        count: count(ec.event_id)
      }
  end
end