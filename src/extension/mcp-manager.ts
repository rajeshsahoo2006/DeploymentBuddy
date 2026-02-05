/**
 * MCP Server Manager
 * Handles lifecycle of the MCP server process and communication
 */

import * as vscode from 'vscode';
import { spawn, ChildProcess, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface McpToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class McpManager {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private serverProcess: ChildProcess | null = null;
  private outputChannel: vscode.OutputChannel;
  private statusBarItem: vscode.StatusBarItem;
  private _isConnected: boolean = false;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Deployment Buddy');
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.text = '$(cloud-offline) Deploy Buddy: Disconnected';
    this.statusBarItem.command = 'deploymentBuddy.startServer';
    this.statusBarItem.show();
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Find Node.js executable path
   * Tries multiple strategies to locate Node.js when PATH is not available
   */
  private findNodeExecutable(): string {
    // Strategy 1: Try process.execPath (VS Code's Node.js)
    if (process.execPath && process.execPath.includes('node')) {
      try {
        // Check if it's actually node (not electron)
        if (fs.existsSync(process.execPath) && !process.execPath.includes('electron')) {
          return process.execPath;
        }
      } catch {
        // Ignore errors
      }
    }

    // Strategy 2: Check VS Code configuration for custom node path
    const config = vscode.workspace.getConfiguration('deploymentBuddy');
    const customNodePath = config.get<string>('nodePath');
    if (customNodePath && fs.existsSync(customNodePath)) {
      return customNodePath;
    }

    // Strategy 3: Try common system locations
    const commonPaths = [
      '/usr/local/bin/node',
      '/opt/homebrew/bin/node',
      '/usr/bin/node',
    ];

    for (const nodePath of commonPaths) {
      try {
        if (fs.existsSync(nodePath)) {
          return nodePath;
        }
      } catch {
        // Continue to next path
      }
    }

    // Strategy 4: Try to find via shell command (if shell is available)
    try {
      // Try to find node in PATH using shell
      const nodePath = execSync('which node', { 
        encoding: 'utf8',
        timeout: 1000,
        env: { ...process.env, PATH: process.env.PATH || '' }
      }).trim();
      
      if (nodePath && fs.existsSync(nodePath)) {
        return nodePath;
      }
    } catch {
      // Shell command failed, continue
    }

    // Strategy 5: Try nvm paths (common on macOS/Linux)
    if (process.env.HOME) {
      const nvmPath = path.join(process.env.HOME, '.nvm');
      if (fs.existsSync(nvmPath)) {
        try {
          // Try to find latest node version in nvm
          const versionsDir = path.join(nvmPath, 'versions', 'node');
          if (fs.existsSync(versionsDir)) {
            const versions = fs.readdirSync(versionsDir)
              .filter(v => v.startsWith('v'))
              .sort()
              .reverse();
            
            for (const version of versions) {
              const nodePath = path.join(versionsDir, version, 'bin', 'node');
              if (fs.existsSync(nodePath)) {
                return nodePath;
              }
            }
          }
        } catch {
          // Ignore errors
        }
      }
    }

    // Fallback: return 'node' and let the error be more descriptive
    return 'node';
  }

  /**
   * Start the MCP server and connect
   */
  async start(): Promise<void> {
    if (this._isConnected) {
      vscode.window.showInformationMessage('Deployment Buddy server is already running');
      return;
    }

    try {
      this.outputChannel.appendLine('Starting Deployment Buddy MCP Server...');
      this.updateStatus('starting');

      // Get configuration
      const config = vscode.workspace.getConfiguration('deploymentBuddy');
      const projectPath = config.get<string>('salesforceProjectPath') || 
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 
        process.cwd();
      const defaultOrg = config.get<string>('defaultOrg') || '';

      // Get the server script path
      const extensionPath = vscode.extensions.getExtension('deployment-buddy.deployment-buddy')?.extensionPath ||
        path.join(__dirname, '..', '..');
      const serverPath = path.join(extensionPath, 'dist', 'server', 'index.js');

      this.outputChannel.appendLine(`Server path: ${serverPath}`);
      this.outputChannel.appendLine(`Project path: ${projectPath}`);

      // Find Node.js executable
      const nodeExecutable = this.findNodeExecutable();
      this.outputChannel.appendLine(`Node executable: ${nodeExecutable}`);

      // Verify node executable exists (unless it's the fallback 'node')
      if (nodeExecutable !== 'node' && !fs.existsSync(nodeExecutable)) {
        throw new Error(
          `Node.js executable not found at ${nodeExecutable}. ` +
          `Please ensure Node.js is installed and accessible. ` +
          `You can set the path manually in VS Code settings.`
        );
      }

      // Create transport with environment variables
      this.transport = new StdioClientTransport({
        command: nodeExecutable,
        args: [serverPath],
        env: {
          ...process.env,
          SF_PROJECT_PATH: projectPath,
          SF_DEFAULT_ORG: defaultOrg,
          // Ensure PATH includes common node locations
          PATH: process.env.PATH || [
            '/usr/local/bin',
            '/opt/homebrew/bin',
            '/usr/bin',
            process.env.HOME ? `${process.env.HOME}/.nvm/versions/node/*/bin` : null,
            process.env.PATH
          ].filter(Boolean).join(':')
        }
      });

      // Create client
      this.client = new Client(
        {
          name: 'deployment-buddy-vscode',
          version: '1.0.0'
        },
        {
          capabilities: {}
        }
      );

      // Connect
      await this.client.connect(this.transport);
      this._isConnected = true;

      this.outputChannel.appendLine('MCP Server connected successfully');
      this.updateStatus('connected');
      
      vscode.window.showInformationMessage('Deployment Buddy server started');
    } catch (error: any) {
      this.outputChannel.appendLine(`Error starting server: ${error.message}`);
      this.updateStatus('error');
      vscode.window.showErrorMessage(`Failed to start Deployment Buddy server: ${error.message}`);
      throw error;
    }
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    if (!this._isConnected) {
      vscode.window.showInformationMessage('Deployment Buddy server is not running');
      return;
    }

    try {
      this.outputChannel.appendLine('Stopping Deployment Buddy MCP Server...');
      
      if (this.client) {
        await this.client.close();
        this.client = null;
      }
      
      if (this.transport) {
        await this.transport.close();
        this.transport = null;
      }

      this._isConnected = false;
      this.updateStatus('disconnected');
      this.outputChannel.appendLine('MCP Server stopped');
      vscode.window.showInformationMessage('Deployment Buddy server stopped');
    } catch (error: any) {
      this.outputChannel.appendLine(`Error stopping server: ${error.message}`);
      vscode.window.showErrorMessage(`Error stopping server: ${error.message}`);
    }
  }

  /**
   * Call an MCP tool
   * For long-running operations like validate_plan, we use a longer timeout
   */
  async callTool(name: string, args: Record<string, any> = {}): Promise<McpToolResult> {
    if (!this._isConnected || !this.client) {
      return {
        success: false,
        error: 'MCP server is not connected. Please start the server first.'
      };
    }

    try {
      this.outputChannel.appendLine(`Calling tool: ${name}`);
      this.outputChannel.appendLine(`Arguments: ${JSON.stringify(args)}`);

      // For long-running operations, add a progress indicator
      const isLongRunning = name === 'validate_plan' || name === 'deploy_plan';
      if (isLongRunning) {
        this.outputChannel.appendLine(`This operation may take several minutes. Please wait...`);
      }

      // Wrap in Promise.race to handle potential timeouts
      // Note: MCP SDK may have its own timeout, but this provides a fallback
      const toolPromise = this.client.callTool({
        name,
        arguments: args
      });

      // Use a longer timeout for long-running operations (5 minutes)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Operation timed out after 5 minutes')), 300000);
      });

      const result = isLongRunning 
        ? await Promise.race([toolPromise, timeoutPromise])
        : await toolPromise;

      this.outputChannel.appendLine(`Tool call completed. isError: ${result.isError}`);

      // Parse the result
      if (result.content && Array.isArray(result.content) && result.content.length > 0) {
        const content = result.content[0];
        if (content.type === 'text') {
          try {
            const parsed = JSON.parse(content.text);
            const toolResult = {
              success: !result.isError,
              data: parsed,
              error: result.isError ? (parsed.message || parsed.error || content.text) : undefined
            };
            
            if (result.isError) {
              this.outputChannel.appendLine(`Tool returned error: ${toolResult.error}`);
            }
            
            return toolResult;
          } catch (parseError) {
            // If JSON parsing fails, return the raw text
            const toolResult = {
              success: !result.isError,
              data: content.text,
              error: result.isError ? content.text : undefined
            };
            
            if (result.isError) {
              this.outputChannel.appendLine(`Tool returned error (non-JSON): ${content.text}`);
            }
            
            return toolResult;
          }
        }
      }

      // If no content, check if there's an error
      const toolResult = {
        success: !result.isError,
        data: result,
        error: result.isError ? 'Unknown error occurred' : undefined
      };
      
      if (result.isError) {
        this.outputChannel.appendLine(`Tool returned error (no content): ${JSON.stringify(result)}`);
      }
      
      return toolResult;
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error occurred';
      this.outputChannel.appendLine(`Tool error: ${errorMessage}`);
      this.outputChannel.appendLine(`Error stack: ${error.stack || 'No stack trace'}`);
      
      // Check if it's a timeout error
      if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
        return {
          success: false,
          error: `Operation timed out. ${errorMessage}. For large plans, consider using validate_batch tool instead.`
        };
      }
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * List available tools
   */
  async listTools(): Promise<any[]> {
    if (!this._isConnected || !this.client) {
      return [];
    }

    try {
      const result = await this.client.listTools();
      return result.tools || [];
    } catch (error) {
      this.outputChannel.appendLine(`Error listing tools: ${error}`);
      return [];
    }
  }

  /**
   * Update status bar
   */
  private updateStatus(status: 'starting' | 'connected' | 'disconnected' | 'error'): void {
    switch (status) {
      case 'starting':
        this.statusBarItem.text = '$(sync~spin) Deploy Buddy: Starting...';
        this.statusBarItem.backgroundColor = undefined;
        break;
      case 'connected':
        this.statusBarItem.text = '$(cloud) Deploy Buddy: Connected';
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.command = 'deploymentBuddy.openUI';
        break;
      case 'disconnected':
        this.statusBarItem.text = '$(cloud-offline) Deploy Buddy: Disconnected';
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.command = 'deploymentBuddy.startServer';
        break;
      case 'error':
        this.statusBarItem.text = '$(error) Deploy Buddy: Error';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.statusBarItem.command = 'deploymentBuddy.startServer';
        break;
    }
  }

  /**
   * Show output channel
   */
  showOutput(): void {
    this.outputChannel.show();
  }

  /**
   * Get output channel for logging
   */
  getOutputChannel(): vscode.OutputChannel {
    return this.outputChannel;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stop();
    this.outputChannel.dispose();
    this.statusBarItem.dispose();
  }
}
