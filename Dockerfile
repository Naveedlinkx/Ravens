# Use Node.js version 16 as base image
FROM node:16

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install application dependencies
RUN npm install

# Copy application source code
COPY . .

# Expose the application port
EXPOSE 3000

# Command to build the application (if applicable)
RUN npm run build

# Command to start the application
CMD ["npm", "start"]