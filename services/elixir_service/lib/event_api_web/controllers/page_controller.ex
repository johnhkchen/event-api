defmodule EventAPIWeb.PageController do
  use EventAPIWeb, :controller

  def home(conn, _params) do
    render(conn, :home)
  end
end
