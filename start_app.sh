#!/bin/bash

# Kill any existing server on port 8000
lsof -ti:8000 | xargs kill -9 2>/dev/null

# Install dependencies if needed (simple check)
if ! python3 -c "import fastapi" 2>/dev/null; then
    echo "Installing Python dependencies..."
    pip3 install -r backend/requirements.txt
fi

echo "Starting Backend Server..."
cd backend
python3 server.py &
BACKEND_PID=$!
cd ..

echo "Backend running on PID $BACKEND_PID"

echo "Starting Electron App..."
npm start

# Cleanup on exit
kill $BACKEND_PID
