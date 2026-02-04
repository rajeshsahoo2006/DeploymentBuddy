/**
 * MCP Server Manager
 * Handles lifecycle of the MCP server process and communication
 */

import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
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

      // Create transport with environment variables
      this.transport = new StdioClientTransport({
        command: 'node',
        args: [serverPath],
        env: {
          ...process.env,
          SF_PROJECT_PATH: projectPath,
          SF_DEFAULT_ORG: defaultOrg
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

      this.outputChannel.appendLine(`Result: ${JSON.stringify(result)}`);

      // Parse the result
      if (result.content && Array.isArray(result.content) && result.content.length > 0) {
        const content = result.content[0];
        if (content.type === 'text') {
          try {
            const parsed = JSON.parse(content.text);
            return {
              success: !result.isError,
              data: parsed,
              error: result.isError ? parsed.message || content.text : undefined
            };
          } catch {
            return {
              success: !result.isError,
              data: content.text,
              error: result.isError ? content.text : undefined
            };
          }
        }
      }

      return {
        success: !result.isError,
        data: result
      };
    } catch (error: any) {
      this.outputChannel.appendLine(`Tool error: ${error.message}`);
      return {
        success: false,
        error: error.message
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
