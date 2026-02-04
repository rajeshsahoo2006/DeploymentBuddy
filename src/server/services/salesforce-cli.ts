/**
 * Salesforce CLI Wrapper Service
 * Handles all interactions with the Salesforce CLI (sf commands)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { OrgInfo, SF_API_VERSION } from '../types';

const execAsync = promisify(exec);

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SfCommandResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  rawOutput?: string;
}

export class SalesforceCli {
  private projectPath: string;
  private defaultOrg?: string;

  constructor(projectPath: string, defaultOrg?: string) {
    this.projectPath = projectPath;
    this.defaultOrg = defaultOrg;
  }

  /**
   * Execute a shell command
   */
  private async execute(command: string, cwd?: string): Promise<CommandResult> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: cwd || this.projectPath,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
        env: { ...process.env, SF_JSON_RESULT: '1' }
      });
      return { success: true, stdout, stderr, exitCode: 0 };
    } catch (error: any) {
      return {
        success: false,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1
      };
    }
  }

  /**
   * Get current org info including API version
   */
  async getOrgInfo(targetOrg?: string): Promise<SfCommandResult<OrgInfo>> {
    const orgFlag = targetOrg || this.defaultOrg ? `-o ${targetOrg || this.defaultOrg}` : '';
    const result = await this.execute(`sf org display ${orgFlag} --json`);

    if (!result.success) {
      return { success: false, error: result.stderr };
    }

    try {
      const parsed = JSON.parse(result.stdout);
      if (parsed.status === 0 && parsed.result) {
        return {
          success: true,
          data: {
            alias: parsed.result.alias || parsed.result.username,
            username: parsed.result.username,
            instanceUrl: parsed.result.instanceUrl,
            orgId: parsed.result.id,
            apiVersion: parsed.result.apiVersion // Include API version from org
          }
        };
      }
      return { success: false, error: parsed.message || 'Unknown error' };
    } catch (e) {
      return { success: false, error: `Failed to parse org info: ${e}` };
    }
  }

  /**
   * Get the API version supported by the target org
   */
  async getOrgApiVersion(targetOrg?: string): Promise<string> {
    const orgInfo = await this.getOrgInfo(targetOrg);
    if (orgInfo.success && orgInfo.data?.apiVersion) {
      return orgInfo.data.apiVersion;
    }
    // Fallback to default if can't get from org
    return SF_API_VERSION;
  }

  /**
   * List all authenticated Salesforce orgs
   */
  async listOrgs(): Promise<SfCommandResult<OrgInfo[]>> {
    const result = await this.execute('sf org list --json');

    if (!result.success) {
      return { success: false, error: result.stderr };
    }

    try {
      const parsed = JSON.parse(result.stdout);
      if (parsed.status === 0 && parsed.result) {
        const orgs: OrgInfo[] = [];
        
        // Process scratch orgs
        if (parsed.result.scratchOrgs) {
          for (const org of parsed.result.scratchOrgs) {
            orgs.push({
              alias: org.alias || org.username,
              username: org.username,
              instanceUrl: org.instanceUrl,
              orgId: org.orgId,
              isDefault: org.isDefaultUsername || false,
              isScratch: true
            });
          }
        }
        
        // Process non-scratch orgs (sandboxes, production)
        if (parsed.result.nonScratchOrgs) {
          for (const org of parsed.result.nonScratchOrgs) {
            orgs.push({
              alias: org.alias || org.username,
              username: org.username,
              instanceUrl: org.instanceUrl,
              orgId: org.orgId,
              isDefault: org.isDefaultUsername || false,
              isScratch: false
            });
          }
        }
        
        // Also check for other orgs in different result structures
        if (parsed.result.other) {
          for (const org of parsed.result.other) {
            orgs.push({
              alias: org.alias || org.username,
              username: org.username,
              instanceUrl: org.instanceUrl,
              orgId: org.orgId,
              isDefault: org.isDefaultUsername || false,
              isScratch: false
            });
          }
        }
        
        return { success: true, data: orgs };
      }
      return { success: false, error: parsed.message || 'Unknown error' };
    } catch (e) {
      return { success: false, error: `Failed to parse org list: ${e}` };
    }
  }

  /**
   * Retrieve metadata using a manifest file
   */
  async retrieveMetadata(manifestPath: string): Promise<SfCommandResult<string>> {
    const orgFlag = this.defaultOrg ? `-o ${this.defaultOrg}` : '';
    const result = await this.execute(
      `sf project retrieve start --manifest "${manifestPath}" ${orgFlag} --json`
    );

    if (!result.success && !result.stdout.includes('"status": 0')) {
      return { success: false, error: result.stderr, rawOutput: result.stdout };
    }

    try {
      const parsed = JSON.parse(result.stdout);
      if (parsed.status === 0) {
        return {
          success: true,
          data: 'Metadata retrieved successfully',
          rawOutput: result.stdout
        };
      }
      return { 
        success: false, 
        error: parsed.message || 'Retrieve failed',
        rawOutput: result.stdout 
      };
    } catch (e) {
      // Sometimes the output is not JSON, treat success based on exit code
      return { 
        success: result.success, 
        data: result.stdout,
        rawOutput: result.stdout 
      };
    }
  }

  /**
   * Deploy metadata using a manifest file
   */
  async deployMetadata(manifestPath: string, checkOnly: boolean = false): Promise<SfCommandResult<any>> {
    const orgFlag = this.defaultOrg ? `-o ${this.defaultOrg}` : '';
    // Use validate command for check-only, deploy start for actual deployment
    const command = checkOnly 
      ? `sf project deploy validate --manifest "${manifestPath}" ${orgFlag} --json --wait 30`
      : `sf project deploy start --manifest "${manifestPath}" ${orgFlag} --json --wait 30`;
    
    const result = await this.execute(command);

    try {
      const parsed = JSON.parse(result.stdout);
      return {
        success: parsed.status === 0,
        data: parsed.result,
        error: parsed.status !== 0 ? (parsed.message || 'Deploy/Validate failed') : undefined,
        rawOutput: result.stdout
      };
    } catch (e) {
      return { 
        success: false, 
        error: result.stderr || `Failed to parse deploy result: ${e}`,
        rawOutput: result.stdout 
      };
    }
  }

  /**
   * Parse validation errors to extract missing custom objects and fields
   */
  parseMissingMetadataErrors(errorDetails: string[]): Array<{ type: string; name: string; objectName?: string }> {
    const missing: Array<{ type: string; name: string; objectName?: string }> = [];
    
    for (const error of errorDetails) {
      // Pattern: "The field \"FieldName__c\" for the object \"ObjectName\" doesn't exist."
      const fieldMatch = error.match(/field\s+["']([A-Za-z0-9_]+__c)["']\s+for\s+the\s+object\s+["']([A-Za-z0-9_]+)["']/i);
      if (fieldMatch) {
        missing.push({
          type: 'CustomField',
          name: fieldMatch[1],
          objectName: fieldMatch[2]
        });
        continue;
      }
      
      // Pattern: "The object \"ObjectName\" doesn't exist."
      const objectMatch = error.match(/object\s+["']([A-Za-z0-9_]+)["']\s+doesn't\s+exist/i);
      if (objectMatch) {
        missing.push({
          type: 'CustomObject',
          name: objectMatch[1]
        });
        continue;
      }
      
      // Pattern with object ID: "The field \"FieldName__c\" for the object \"01I...\" doesn't exist."
      // Need to resolve object ID to name
      const fieldWithIdMatch = error.match(/field\s+["']([A-Za-z0-9_]+__c)["']\s+for\s+the\s+object\s+["']([0-9A-Za-z]+)["']/i);
      if (fieldWithIdMatch) {
        missing.push({
          type: 'CustomField',
          name: fieldWithIdMatch[1],
          objectName: fieldWithIdMatch[2] // This is an ID, will need to resolve
        });
      }
    }
    
    return missing;
  }

  /**
   * Resolve object ID to object API name by checking local project
   */
  async resolveObjectIdToName(objectId: string): Promise<string | null> {
    // Object IDs typically start with specific prefixes (e.g., 01I for custom objects)
    // Try to find the object in local project
    const objectsPath = path.join(this.projectPath, 'force-app', 'main', 'default', 'objects');
    
    try {
      const entries = await fs.readdir(objectsPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Check if this object's metadata file contains the ID
          const objectMetaPath = path.join(objectsPath, entry.name, `${entry.name}.object-meta.xml`);
          try {
            const content = await fs.readFile(objectMetaPath, 'utf8');
            // Check if the file contains the object ID (in fullName or other fields)
            if (content.includes(objectId)) {
              return entry.name;
            }
          } catch {
            // Continue searching
          }
        }
      }
    } catch {
      // Objects directory doesn't exist
    }
    
    return null;
  }

  /**
   * Retrieve specific custom object or field from org
   */
  async retrieveCustomMetadata(
    metadataType: 'CustomObject' | 'CustomField',
    name: string,
    objectName?: string
  ): Promise<SfCommandResult<string>> {
    const orgFlag = this.defaultOrg ? `-o ${this.defaultOrg}` : '';
    
    let metadataTypeArg: string;
    let metadataName: string;
    
    if (metadataType === 'CustomObject') {
      metadataTypeArg = 'CustomObject';
      metadataName = name;
    } else {
      // For CustomField, format is ObjectName.FieldName__c
      metadataTypeArg = 'CustomField';
      
      // If objectName looks like an ID (starts with numbers), try to resolve it
      if (objectName && /^[0-9]/.test(objectName)) {
        const resolvedName = await this.resolveObjectIdToName(objectName);
        if (resolvedName) {
          metadataName = `${resolvedName}.${name}`;
        } else {
          // Can't resolve ID, return error
          return {
            success: false,
            error: `Cannot resolve object ID ${objectName} to object name. Please retrieve the CustomObject first or specify the object API name.`
          };
        }
      } else {
        metadataName = objectName ? `${objectName}.${name}` : name;
      }
    }
    
    const result = await this.execute(
      `sf project retrieve start --metadata ${metadataTypeArg}:${metadataName} ${orgFlag} --json`
    );

    if (!result.success && !result.stdout.includes('"status": 0')) {
      return { success: false, error: result.stderr, rawOutput: result.stdout };
    }

    try {
      const parsed = JSON.parse(result.stdout);
      if (parsed.status === 0) {
        return {
          success: true,
          data: `Retrieved ${metadataType}: ${metadataName}`,
          rawOutput: result.stdout
        };
      }
      return { 
        success: false, 
        error: parsed.message || 'Retrieve failed',
        rawOutput: result.stdout 
      };
    } catch (e) {
      return { 
        success: result.success, 
        data: result.stdout,
        rawOutput: result.stdout 
      };
    }
  }

  /**
   * Validate metadata using a manifest file (check-only deployment)
   * Returns detailed error information for missing dependencies
   */
  async validateMetadata(manifestPath: string): Promise<SfCommandResult<any> & { 
    missingMetadata?: Array<{ type: string; name: string; objectName?: string }>;
    errorDetails?: string[];
  }> {
    const orgFlag = this.defaultOrg ? `-o ${this.defaultOrg}` : '';
    const result = await this.execute(
      `sf project deploy validate --manifest "${manifestPath}" ${orgFlag} --json --wait 30`
    );

    try {
      const parsed = JSON.parse(result.stdout);
      const response: SfCommandResult<any> & { 
        missingMetadata?: Array<{ type: string; name: string }>;
        errorDetails?: string[];
      } = {
        success: parsed.status === 0,
        data: parsed.result,
        error: parsed.status !== 0 ? (parsed.message || 'Validation failed') : undefined,
        rawOutput: result.stdout
      };

      // Parse error details to find missing metadata
      if (!response.success) {
        response.missingMetadata = [];
        response.errorDetails = [];
        
        // Check for component failures in the result
        if (parsed.result?.details?.componentFailures) {
          const failures = Array.isArray(parsed.result.details.componentFailures) 
            ? parsed.result.details.componentFailures 
            : [parsed.result.details.componentFailures];
          
          for (const failure of failures) {
            const errorMsg = `${failure.componentType}/${failure.fullName}: ${failure.problem}`;
            response.errorDetails.push(errorMsg);
          }
        }
        
        // Also check the raw error message
        if (parsed.message) {
          response.errorDetails.push(parsed.message);
        }
        
        // Parse all error details to extract missing custom objects and fields
        const parsedMissing = this.parseMissingMetadataErrors(response.errorDetails);
        response.missingMetadata = parsedMissing;
      }

      return response;
    } catch (e) {
      return { 
        success: false, 
        error: result.stderr || `Failed to parse validation result: ${e}`,
        rawOutput: result.stdout,
        errorDetails: [result.stderr || String(e)]
      };
    }
  }

  /**
   * Validate specific components and return detailed results
   */
  async validateComponents(
    components: Array<{ type: string; name: string }>
  ): Promise<SfCommandResult<any> & { 
    missingMetadata?: Array<{ type: string; name: string }>;
    errorDetails?: string[];
    manifestPath?: string;
  }> {
    // Create a temporary manifest
    const tempDir = path.join(this.projectPath, '.deployment-buddy-temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    // Get API version from target org
    const apiVersion = await this.getOrgApiVersion();
    
    const manifestPath = path.join(tempDir, 'validate-manifest.xml');
    const manifestContent = this.generatePackageXml(components, apiVersion);
    await fs.writeFile(manifestPath, manifestContent, 'utf8');

    try {
      const result = await this.validateMetadata(manifestPath);
      return { ...result, manifestPath };
    } finally {
      // Don't cleanup immediately - might need to inspect the manifest
      // Cleanup will happen on next validation or deploy
    }
  }

  /**
   * Deploy specific metadata components
   */
  async deployComponents(
    components: Array<{ type: string; name: string }>,
    checkOnly: boolean = false
  ): Promise<SfCommandResult<any>> {
    // Create a temporary manifest
    const tempDir = path.join(this.projectPath, '.deployment-buddy-temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    // Get API version from target org
    const apiVersion = await this.getOrgApiVersion();
    
    const manifestPath = path.join(tempDir, 'deploy-manifest.xml');
    const manifestContent = this.generatePackageXml(components, apiVersion);
    await fs.writeFile(manifestPath, manifestContent, 'utf8');

    try {
      return await this.deployMetadata(manifestPath, checkOnly);
    } finally {
      // Cleanup temp file
      try {
        await fs.unlink(manifestPath);
        await fs.rmdir(tempDir);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Generate package.xml content
   * @param components - Array of components to include
   * @param apiVersion - Optional API version (defaults to SF_API_VERSION or org's version)
   */
  generatePackageXml(components: Array<{ type: string; name: string }>, apiVersion?: string): string {
    // Group components by type
    const typeMap = new Map<string, string[]>();
    for (const comp of components) {
      const members = typeMap.get(comp.type) || [];
      members.push(comp.name);
      typeMap.set(comp.type, members);
    }

    let typesXml = '';
    for (const [typeName, members] of typeMap) {
      const membersXml = members.map(m => `        <members>${m}</members>`).join('\n');
      typesXml += `    <types>
${membersXml}
        <name>${typeName}</name>
    </types>\n`;
    }

    // Use provided apiVersion, or fall back to default
    const version = apiVersion || SF_API_VERSION;

    return `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
${typesXml}    <version>${version}</version>
</Package>`;
  }

  /**
   * Generate package.xml content with org's API version
   */
  async generatePackageXmlWithOrgVersion(components: Array<{ type: string; name: string }>): Promise<string> {
    const apiVersion = await this.getOrgApiVersion();
    return this.generatePackageXml(components, apiVersion);
  }

  /**
   * Write a package.xml file to the specified path
   */
  async writePackageXml(
    targetPath: string,
    components: Array<{ type: string; name: string }>
  ): Promise<SfCommandResult<string>> {
    try {
      const dir = path.dirname(targetPath);
      await fs.mkdir(dir, { recursive: true });
      
      // Get API version from target org
      const apiVersion = await this.getOrgApiVersion();
      
      const content = this.generatePackageXml(components, apiVersion);
      await fs.writeFile(targetPath, content, 'utf8');
      
      return { success: true, data: targetPath };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Get project path
   */
  getProjectPath(): string {
    return this.projectPath;
  }

  /**
   * Set default org
   */
  setDefaultOrg(org: string): void {
    this.defaultOrg = org;
  }
}

/**
 * Default package.xml content for GenAI Bot deployment
 */
export function getDefaultPackageXmlComponents(): Array<{ type: string; name: string }> {
  return [
    { type: 'Bot', name: '*' },
    { type: 'BotVersion', name: '*' },
    { type: 'GenAiFunction', name: '*' },
    { type: 'GenAiPlugin', name: '*' },
    { type: 'GenAiPlannerBundle', name: '*' },
    { type: 'ApexClass', name: '*' },
    { type: 'Flow', name: '*' }
  ];
}
