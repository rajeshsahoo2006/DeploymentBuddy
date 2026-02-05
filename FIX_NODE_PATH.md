# Fixed: "spawn node ENOENT" Error

## Problem
The extension was failing to start with the error:
```
Error starting server: spawn node ENOENT
```

This happened because VS Code extensions don't always have access to your shell's PATH environment variable, especially when Node.js is installed via nvm (Node Version Manager).

## Solution
The extension now automatically detects Node.js using multiple strategies:

1. **VS Code's Node.js** - Uses `process.execPath` if available
2. **Custom Configuration** - Checks VS Code setting `deploymentBuddy.nodePath`
3. **Common System Paths** - Checks `/usr/local/bin/node`, `/opt/homebrew/bin/node`, `/usr/bin/node`
4. **Shell Command** - Tries `which node` command
5. **NVM Paths** - Automatically searches `~/.nvm/versions/node/` for installed versions
6. **Fallback** - Falls back to 'node' with a descriptive error message

## What You Need to Do

### Option 1: Let It Auto-Detect (Recommended)
The extension should now automatically find your Node.js installation. Simply try starting the server again:
1. Open Command Palette (`Cmd+Shift+P`)
2. Run `Deployment Buddy: Start MCP Server`
3. Check the output channel for the detected Node.js path

### Option 2: Manually Set Node.js Path
If auto-detection still doesn't work, you can manually specify the path:

1. Open VS Code Settings (`Cmd+,` or `Ctrl+,`)
2. Search for `deploymentBuddy.nodePath`
3. Set it to your Node.js path, for example:
   ```
   /Users/rsahoo/.nvm/versions/node/v22.8.0/bin/node
   ```

To find your Node.js path, run in terminal:
```bash
which node
```

### Option 3: Reload VS Code
After rebuilding, you may need to reload VS Code:
1. Open Command Palette (`Cmd+Shift+P`)
2. Run `Developer: Reload Window`

## Verification

After starting the server, check the "Deployment Buddy" output channel:
- You should see: `Node executable: /path/to/node`
- You should see: `MCP Server connected successfully`

If you still see errors, the output channel will show which strategies were tried and why they failed.

## Next Steps

Once the server starts successfully:
1. The status bar should show: `$(cloud) Deploy Buddy: Connected`
2. You can open the UI: `Deployment Buddy: Open Bot Deployer`
3. Or use MCP tools directly in Cursor IDE
