defmodule EventAPI.Processing.ContentExtractor do
  @moduledoc """
  GenServer for extracting content from scraped HTML using AI services.
  
  This service processes raw HTML from scraped events and extracts:
  - Structured event data
  - Speaker information
  - Company details
  - Topic categorization
  """
  
  use GenServer
  require Logger
  alias EventAPI.Services.BAMLClient

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    Logger.info("ContentExtractor started")
    {:ok, %{}}
  end

  # Public API

  def extract_content(html_content) when is_binary(html_content) do
    GenServer.call(__MODULE__, {:extract_content, html_content}, 60_000)
  end

  def extract_content(_), do: {:error, "invalid_html"}

  def extract_batch(html_documents) when is_list(html_documents) do
    GenServer.call(__MODULE__, {:extract_batch, html_documents}, 120_000)
  end

  def extract_batch(_), do: {:error, "invalid_documents"}

  # GenServer callbacks

  @impl true
  def handle_call({:extract_content, html_content}, _from, state) do
    Logger.debug("Extracting content from HTML")
    
    result = case BAMLClient.extract_content(html_content) do
      {:ok, extracted_data} ->
        Logger.info("Successfully extracted content")
        {:ok, extracted_data}
        
      {:error, reason} = error ->
        Logger.error("Content extraction failed: #{inspect(reason)}")
        error
    end
    
    {:reply, result, state}
  end

  @impl true
  def handle_call({:extract_batch, html_documents}, _from, state) do
    Logger.info("Processing batch extraction for #{length(html_documents)} documents")
    
    result = case BAMLClient.extract_batch(html_documents) do
      {:ok, results} ->
        Logger.info("Successfully processed batch extraction")
        {:ok, results}
        
      {:error, reason} = error ->
        Logger.error("Batch extraction failed: #{inspect(reason)}")
        error
    end
    
    {:reply, result, state}
  end
end