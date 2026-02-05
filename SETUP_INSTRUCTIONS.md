# DeploymentBuddy MCP Server Setup Instructions

## ✅ What's Already Done

1. ✓ Server has been built successfully (`dist/server/index.js` exists)
2. ✓ Salesforce CLI is installed and available
3. ✓ MCP configuration template created (`mcp.json`)

## 📋 Next Steps

### Option 1: Project-Level Configuration (Recommended)

If you have a Salesforce project, add the MCP server to that project:

1. **Navigate to your Salesforce project root** (the folder containing `force-app` or `sfdx-project.json`)

2. **Create the `.cursor` directory** (if it doesn't exist):
   ```bash
   mkdir -p .cursor
   ```

3. **Copy the MCP configuration**:
   ```bash
   cp /Users/rsahoo/Downloads/DeploymentBuddy/mcp.json .cursor/mcp.json
   ```

4. **Edit `.cursor/mcp.json`** and update these values:
   - `SF_PROJECT_PATH`: Change `/path/to/your/salesforce/project` to your actual Salesforce project path
   - `SF_DEFAULT_ORG`: Change `your-org-alias` to your Salesforce org alias (or leave empty if you want to specify it per operation)

   Example:
   ```json
   {
     "mcpServers": {
       "deployment-buddy": {
         "command": "node",
         "args": [
           "/Users/rsahoo/Downloads/DeploymentBuddy/dist/server/index.js"
         ],
         "env": {
           "SF_PROJECT_PATH": "/Users/rsahoo/my-salesforce-project",
           "SF_DEFAULT_ORG": "my-org"
         }
       }
     }
   }
   ```

### Option 2: Global Configuration

To use DeploymentBuddy across all projects:

1. **Create or edit your global Cursor MCP config**:
   ```bash
   mkdir -p ~/.cursor
   cp /Users/rsahoo/Downloads/DeploymentBuddy/mcp.json ~/.cursor/mcp.json
   ```

2. **Edit `~/.cursor/mcp.json`** and update the `SF_PROJECT_PATH` and `SF_DEFAULT_ORG` values as described above.

## 🔍 Verify Setup

1. **Restart Cursor IDE** (important - MCP config is loaded on startup)

2. **Open the MCP panel**:
   - View → MCP Servers (or use Command Palette)
   - You should see "deployment-buddy" listed

3. **Check server status**:
   - The server should show as "connected"
   - You should see all the available tools listed

## 🛠️ Troubleshooting

### Server Not Connecting

1. **Check the server path**:
   ```bash
   ls -la /Users/rsahoo/Downloads/DeploymentBuddy/dist/server/index.js
   ```
   Should show the file exists.

2. **Test the server manually**:
   ```bash
   node /Users/rsahoo/Downloads/DeploymentBuddy/dist/server/index.js
   ```
   You should see: `Deployment Buddy MCP Server running on stdio`
   (Press Ctrl+C to stop)

3. **Check Cursor's MCP logs**:
   - Open Cursor's Developer Tools (Help → Toggle Developer Tools)
   - Look for MCP-related errors in the console

### Tools Not Appearing

1. **Verify JSON syntax**:
   ```bash
   node -e "JSON.parse(require('fs').readFileSync('.cursor/mcp.json', 'utf8'))"
   ```
   Should not show any errors.

2. **Check environment variables**:
   - Ensure `SF_PROJECT_PATH` points to a valid Salesforce project
   - Verify `SF_DEFAULT_ORG` is correct (or leave empty)

### Salesforce CLI Errors

1. **Verify Salesforce CLI is authenticated**:
   ```bash
   sf org list
   ```

2. **Set a default org** (if needed):
   ```bash
   sf org login web --alias my-org --set-default
   ```

## 📝 Quick Test

Once configured, try asking Cursor:

> "List all Einstein Bots in my Salesforce project"

Or:

> "What GenAI assets do I have?"

Cursor should be able to use the DeploymentBuddy MCP tools to answer these questions.

## 🆘 Still Having Issues?

1. Check that Node.js is in your PATH:
   ```bash
   which node
   ```

2. Verify the server file is executable:
   ```bash
   file /Users/rsahoo/Downloads/DeploymentBuddy/dist/server/index.js
   ```

3. Check Cursor's MCP server logs for detailed error messages
