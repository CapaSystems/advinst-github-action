import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as toolCache from '@actions/tool-cache';

import {dirname, join} from 'path';
import {exists, getRunnerTempDir, getVariable} from './utils';
import util from 'util';

export class AdvinstTool {
  private version: string;
  private license: string;
  private enableCom: boolean;

  private static readonly advinstCustomUrlVar = 'advancedinstaller_url';
  private static readonly advinstDownloadUrlTemplate =
    'https://www.advancedinstaller.com/downloads/%s/advinst.msi';
  private static readonly advinstExtractCmdTemplate =
    'msiexec /a "%s" TARGETDIR="%s" /qn';
  private static readonly advinstRegisterCmdTemplate = '%s /RegisterCI %s';
  private static readonly advinstStartComCmdTemplate = '%s /REGSERVER';
  private static readonly advinstComPathTemplate =
    '%s\\bin\\x86\\advancedinstaller.com';
  private static readonly asdvinstMsbuildTagetPathTemplate =
    '%s\\ProgramFilesFolder\\MSBuild\\Caphyon\\Advanced Installer';

  private static readonly advinstCacheToolName = 'advinst';
  private static readonly advinstCacheToolArch = 'x86';

  private static readonly advinstMSBuildTargetsVar =
    'AdvancedInstallerMSBuildTargets';
  private static readonly advinstToolRootVar = 'AdvancedInstallerRoot';

  constructor(version: string, license: string, enableCom: boolean) {
    this.version = version;
    this.license = license;
    this.enableCom = enableCom;
  }

  /**
   * Normalizes version to full SemVer format (MAJOR.MINOR.PATCH) required by tool-cache
   * @param version Original version string
   * @returns Normalized version string
   */
  private normalizeVersionForCache(version: string): string {
    const parts = version.split('.');

    // If already in MAJOR.MINOR.PATCH format, return as-is
    if (parts.length >= 3) {
      return version;
    }

    // If MAJOR.MINOR format, add .0 for patch
    if (parts.length === 2) {
      return `${version}.0`;
    }

    // If only MAJOR, add .0.0
    if (parts.length === 1) {
      return `${version}.0.0`;
    }

    // Fallback - return original
    return version;
  }

  async getPath(): Promise<string> {
    //Check cache first
    core.info(`Checking cache for advinst tool with version: ${this.version}`);

    // Normalize version to full SemVer format for tool-cache compatibility
    // tool-cache requires MAJOR.MINOR.PATCH format
    const normalizedVersion = this.normalizeVersionForCache(this.version);
    if (normalizedVersion !== this.version) {
      core.info(
        `Normalized version ${this.version} to ${normalizedVersion} for tool-cache compatibility`
      );
    }

    let toolRoot = toolCache.find(
      AdvinstTool.advinstCacheToolName,
      normalizedVersion,
      AdvinstTool.advinstCacheToolArch
    );

    //If not in cache, download and extract
    if (!toolRoot) {
      core.info('Tool not found in cache');
      const setup = await this.download();
      toolRoot = await this.extract(setup);
    } else {
      core.info('Tool found in cache');
    }

    //Register and enable COM
    const toolPath = util.format(AdvinstTool.advinstComPathTemplate, toolRoot);
    const ret = await exists(toolPath);
    if (!ret) {
      throw new Error(
        util.format('Expected to find %s, but it was not found.', toolPath)
      );
    }
    await this.register(toolPath);
    await this.registerCom(toolPath);
    this.exportVariables(toolRoot);

    //Add to PATH
    core.addPath(dirname(toolPath));

    return toolPath;
  }

  async download(): Promise<string> {
    //Check if a custom URL is set. If so, use it.
    const customUrl = getVariable(AdvinstTool.advinstCustomUrlVar);
    if (customUrl) {
      core.info(
        util.format('Using custom URL for advinst tool: %s', customUrl)
      );
      return await toolCache.downloadTool(customUrl);
    }

    core.info(`Downloading advinst tool with version: ${this.version}`);
    const url = util.format(
      AdvinstTool.advinstDownloadUrlTemplate,
      this.version
    );
    return await toolCache.downloadTool(url);
  }

  async extract(setupPath: string): Promise<string> {
    //Extract to agent temp folder
    core.info('Extracting advinst tool');
    const extractFolder = join(getRunnerTempDir(), 'advinst');
    const cmd = util.format(
      AdvinstTool.advinstExtractCmdTemplate,
      setupPath,
      extractFolder
    );
    const ret = await exec.getExecOutput(cmd);
    if (ret.exitCode !== 0) {
      throw new Error(ret.stdout);
    }

    // Use normalized version for caching to ensure consistency with find operations
    const normalizedVersion = this.normalizeVersionForCache(this.version);
    return await toolCache.cacheDir(
      extractFolder,
      AdvinstTool.advinstCacheToolName,
      normalizedVersion,
      AdvinstTool.advinstCacheToolArch
    );
  }

  async register(toolPath: string): Promise<void> {
    if (this.license) {
      core.info('Registering advinst tool');
      const cmd = util.format(
        AdvinstTool.advinstRegisterCmdTemplate,
        toolPath,
        this.license
      );
      const ret = await exec.getExecOutput(cmd);
      if (ret.exitCode !== 0) {
        throw new Error(ret.stdout);
      }
    }
  }

  async registerCom(toolPath: string): Promise<void> {
    if (this.enableCom) {
      core.info('Enabling advinst COM interface');
      const cmd = util.format(AdvinstTool.advinstStartComCmdTemplate, toolPath);
      const ret = await exec.getExecOutput(cmd);
      if (ret.exitCode !== 0) {
        throw new Error(ret.stdout);
      }
    }
  }

  exportVariables(toolRoot: string): void {
    core.exportVariable(AdvinstTool.advinstToolRootVar, toolRoot);
    core.exportVariable(
      AdvinstTool.advinstMSBuildTargetsVar,
      util.format(AdvinstTool.asdvinstMsbuildTagetPathTemplate, toolRoot)
    );
  }
}
