#!/bin/bash

echo "🚀 Installing MongoDB 7.0 for Ubuntu..."

# Import the public key used by the package management system
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
   sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg \
   --dearmor --yes

# Create a list file for MongoDB
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list > /dev/null

# Reload local package database
sudo apt-get update

# Install the MongoDB packages
sudo apt-get install -y mongodb-org

# Start MongoDB
sudo systemctl start mongod

# Enable it to start on boot
sudo systemctl enable mongod

echo "✅ MongoDB installation complete and service started!"
echo "Check status directly with: sudo systemctl status mongod"
