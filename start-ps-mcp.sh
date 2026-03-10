#!/bin/bash
cd "$(dirname "$0")/mcp"
exec "$(dirname "$0")/.venv/bin/python" ps-mcp.py
