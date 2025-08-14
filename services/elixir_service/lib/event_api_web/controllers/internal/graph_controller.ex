defmodule EventAPIWeb.Internal.GraphController do
  @moduledoc """
  Controller for graph relationship query endpoints.
  
  These endpoints provide access to graph-based relationship analysis
  using Apache AGE for complex queries on event, speaker, and company relationships.
  """
  
  use EventAPIWeb, :controller
  require Logger
  
  alias EventAPI.Processing.GraphService
  
  action_fallback EventAPIWeb.FallbackController

  @doc """
  Query graph relationships based on a graph query string.
  
  ## Parameters
  - query: Graph query string (e.g., "speakers", "events", "companies")
  
  ## Response
  Returns graph relationship data including nodes, edges, and metadata.
  """
  def query(conn, %{"query" => query}) do
    Logger.info("Processing graph query: #{query}")
    
    case GraphService.query_relationships(query) do
      {:ok, result} ->
        conn
        |> put_status(:ok)
        |> json(%{
          success: true,
          data: result
        })
        
      {:error, reason} ->
        Logger.error("Graph query failed for '#{query}': #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Build a graph of relationships for a specific speaker.
  
  ## Parameters
  - speaker_id: The ID of the speaker to analyze
  
  ## Response
  Returns the speaker's relationship graph including events, co-speakers, and organizations.
  """
  def speaker(conn, %{"speaker_id" => speaker_id}) do
    Logger.info("Building speaker graph for ID: #{speaker_id}")
    
    case GraphService.build_speaker_graph(speaker_id) do
      {:ok, result} ->
        conn
        |> put_status(:ok)
        |> json(%{
          success: true,
          data: result
        })
        
      {:error, reason} ->
        Logger.error("Speaker graph failed for ID '#{speaker_id}': #{inspect(reason)}")
        {:error, reason}
    end
  end
end