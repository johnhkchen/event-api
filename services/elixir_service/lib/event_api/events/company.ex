defmodule EventAPI.Events.Company do
  @moduledoc """
  Schema for companies table.
  
  Handles company data with normalization for deduplication
  and domain-based validation.
  """

  use Ecto.Schema
  import Ecto.Changeset
  import Ecto.Query

  alias EventAPI.Events.{Event, EventCompany}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "companies" do
    field :name, :string
    field :normalized_name, :string
    field :domain, :string
    field :industry, :string
    timestamps(type: :utc_datetime, updated_at: false)

    # Many-to-many associations
    many_to_many :events, Event,
      join_through: EventCompany,
      join_keys: [company_id: :id, event_id: :id]

    # Junction table association for detailed queries
    has_many :event_companies, EventCompany, foreign_key: :company_id
  end

  @doc """
  Changeset for creating and updating companies.
  """
  def changeset(company, attrs) do
    company
    |> cast(attrs, [:name, :domain, :industry])
    |> validate_required([:name])
    |> validate_length(:name, min: 1, max: 200)
    |> validate_length(:domain, max: 100)
    |> validate_length(:industry, max: 100)
    |> validate_domain()
    |> put_normalized_name()
    |> validate_non_empty_name()
    |> unique_constraint(:normalized_name)
  end

  @doc """
  Changeset for normalization/deduplication operations.
  """
  def normalization_changeset(company, attrs) do
    company
    |> cast(attrs, [:name, :normalized_name, :domain, :industry])
    |> validate_required([:name, :normalized_name])
    |> validate_domain()
    |> validate_non_empty_name()
    |> unique_constraint(:normalized_name)
  end

  # Private validation functions

  defp validate_domain(changeset) do
    validate_change(changeset, :domain, fn field, value ->
      case value do
        nil -> []
        "" -> []
        domain when is_binary(domain) ->
          if valid_domain?(domain) do
            []
          else
            [{field, "must be a valid domain name"}]
          end
        _ -> [{field, "must be a string"}]
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

  # Domain validation
  defp valid_domain?(domain) do
    # Basic domain validation - matches a simple domain pattern
    domain_pattern = ~r/^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/
    String.match?(domain, domain_pattern)
  end

  @doc """
  Normalize a company name for deduplication.
  
  Normalization rules:
  - Convert to lowercase
  - Remove common business suffixes (Inc., Corp., Ltd., etc.)
  - Remove extra whitespace and punctuation
  - Handle common abbreviations
  """
  def normalize_name(name) when is_binary(name) do
    name
    |> String.trim()
    |> String.downcase()
    |> remove_business_suffixes()
    |> normalize_business_terms()
    |> normalize_punctuation()
    |> normalize_whitespace()
    |> String.trim()
  end

  # Private normalization helpers

  defp remove_business_suffixes(name) do
    suffixes = [
      # Common business suffixes
      ~r/\s+(inc\.?|incorporated)$/i,
      ~r/\s+(corp\.?|corporation)$/i,
      ~r/\s+(ltd\.?|limited)$/i,
      ~r/\s+(llc\.?)$/i,
      ~r/\s+(co\.?)$/i,
      ~r/\s+(company)$/i,
      ~r/\s+(group)$/i,
      ~r/\s+(holdings?)$/i,
      ~r/\s+(enterprises?)$/i,
      ~r/\s+(solutions?)$/i,
      ~r/\s+(systems?)$/i,
      ~r/\s+(technologies)$/i,
      ~r/\s+(tech)$/i,
      ~r/\s+(software)$/i,
      ~r/\s+(labs?)$/i,
      ~r/\s+(ventures?)$/i,
      ~r/\s+(partners?|partnership)$/i,
      ~r/\s+(consulting)$/i,
      ~r/\s+(services?)$/i,
      ~r/\s+(international)$/i,
      ~r/\s+(global)$/i,
      ~r/\s+(worldwide)$/i
    ]
    
    Enum.reduce(suffixes, name, fn suffix, acc ->
      String.replace(acc, suffix, "")
    end)
  end

  defp normalize_business_terms(name) do
    # Normalize common abbreviations and variations
    normalizations = [
      {~r/\b(technology|technologies)\b/i, "tech"},
      {~r/\b(software|sw)\b/i, "software"},
      {~r/\b(laboratory|laboratories)\b/i, "lab"},
      {~r/\b(international|intl)\b/i, "international"},
      {~r/\b(corporation)\b/i, "corp"},
      {~r/\b(incorporated)\b/i, "inc"},
      {~r/\b(limited)\b/i, "ltd"},
      {~r/\b(company)\b/i, "co"},
      {~r/\b(and|&)\b/i, "&"}
    ]
    
    Enum.reduce(normalizations, name, fn {pattern, replacement}, acc ->
      String.replace(acc, pattern, replacement)
    end)
  end

  defp normalize_punctuation(name) do
    name
    |> String.replace(~r/[^\w\s&'-]/, "")
    |> String.replace(~r/['']/, "'")
  end

  defp normalize_whitespace(name) do
    String.replace(name, ~r/\s+/, " ")
  end

  @doc """
  Extract domain from various input formats (URL, email, etc.).
  """
  def extract_domain(input) when is_binary(input) do
    cond do
      # URL format
      String.starts_with?(input, "http") ->
        case URI.parse(input) do
          %URI{host: host} when is_binary(host) -> clean_domain(host)
          _ -> nil
        end
      
      # Email format
      String.contains?(input, "@") ->
        case String.split(input, "@") do
          [_user, domain] -> clean_domain(domain)
          _ -> nil
        end
      
      # Domain-like string
      valid_domain?(input) ->
        clean_domain(input)
      
      true ->
        nil
    end
  end

  def extract_domain(_), do: nil

  defp clean_domain(domain) do
    domain
    |> String.downcase()
    |> String.trim()
    |> String.replace_leading("www.", "")
  end

  @doc """
  Calculate similarity between two normalized company names.
  Uses a combination of exact match, substring match, and fuzzy matching.
  """
  def name_similarity(name1, name2) when is_binary(name1) and is_binary(name2) do
    cond do
      name1 == name2 -> 1.0
      String.contains?(name1, name2) or String.contains?(name2, name1) -> 0.8
      true -> jaro_winkler_similarity(name1, name2)
    end
  end

  # Simple Jaro-Winkler implementation for company name matching
  defp jaro_winkler_similarity(s1, s2) do
    # Simplified implementation - in production, use a proper string similarity library
    words1 = String.split(s1)
    words2 = String.split(s2)
    
    common_words = Enum.count(words1, fn w1 -> 
      Enum.any?(words2, fn w2 -> w1 == w2 end)
    end)
    
    total_words = max(length(words1), length(words2))
    
    if total_words > 0 do
      common_words / total_words
    else
      0.0
    end
  end

  @doc """
  Query helper to find companies by domain.
  """
  def by_domain_query(domain) when is_binary(domain) do
    clean_domain = clean_domain(domain)
    
    from c in __MODULE__,
      where: c.domain == ^clean_domain,
      order_by: c.name
  end

  @doc """
  Query helper to find similar companies by normalized name.
  """
  def similar_names_query(normalized_name) do
    # Use substring matching for similarity
    pattern = "%#{normalized_name}%"
    
    from c in __MODULE__,
      where: c.normalized_name == ^normalized_name
      or like(c.normalized_name, ^pattern)
      or like(^normalized_name, fragment("'%' || ? || '%'", c.normalized_name)),
      order_by: c.normalized_name
  end

  @doc """
  Query helper to find companies by industry.
  """
  def by_industry_query(industry) when is_binary(industry) do
    from c in __MODULE__,
      where: ilike(c.industry, ^"%#{industry}%"),
      order_by: c.name
  end

  @doc """
  Query helper for companies with domains (more reliable for deduplication).
  """
  def with_domains_query do
    from c in __MODULE__,
      where: not is_nil(c.domain) and c.domain != "",
      order_by: c.domain
  end

  @doc """
  Query helper to search companies by name or domain.
  """
  def search_query(search_term) when is_binary(search_term) do
    pattern = "%#{search_term}%"
    
    from c in __MODULE__,
      where: ilike(c.name, ^pattern)
      or ilike(c.normalized_name, ^pattern)
      or ilike(c.domain, ^pattern),
      order_by: c.name
  end
end