// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import * as path from 'path';
import { glob, hasMagic } from 'glob';
import { RelativePattern, Uri, workspace, WorkspaceFolder } from 'vscode';
import { JavaTestRunnerDelegateCommands } from '../constants';
import { executeJavaLanguageServerCommand } from '../utils/commandUtils';

class TestSourcePathProvider {
    private testSourceMapping: Map<Uri, ITestSourcePath[]> = new Map();
    private additionalTestSourceMapping: Map<Uri, Promise<string[]>> = new Map();

    public async getTestSourcePattern(workspaceFolder: WorkspaceFolder, containsGeneral: boolean = true): Promise<RelativePattern[]> {
        const patterns: RelativePattern[] = [];
        const sourcePaths: string[] = await testSourceProvider.getTestSourcePath(workspaceFolder, containsGeneral);
        for (const sourcePath of sourcePaths) {
            const normalizedPath: string = Uri.file(sourcePath).fsPath;
            const pattern: RelativePattern = new RelativePattern(normalizedPath, '**/*.java');
            patterns.push(pattern);
        }
        return patterns;
    }

    public async getTestSourcePath(workspaceFolder: WorkspaceFolder, containsGeneral: boolean = true): Promise<string[]> {
        const testPaths: ITestSourcePath[] = await this.getTestPaths(workspaceFolder);

        if (containsGeneral) {
            return testPaths.map((s: ITestSourcePath) => s.testSourcePath);
        }

        return testPaths.filter((s: ITestSourcePath) => s.isStrict)
            .map((s: ITestSourcePath) => s.testSourcePath);
    }

    public getAdditionalTestSourcePaths(workspaceFolder: WorkspaceFolder): Promise<string[]> {
        const configuredPaths: string[] = workspace.getConfiguration('java.test', workspaceFolder.uri)
            .get<string[]>('additionalTestSourcePaths', []);
        let resolvedPaths: Promise<string[]> | undefined = this.additionalTestSourceMapping.get(workspaceFolder.uri);
        if (!resolvedPaths) {
            resolvedPaths = resolveAdditionalTestSourcePaths(workspaceFolder.uri.fsPath, configuredPaths);
            this.additionalTestSourceMapping.set(workspaceFolder.uri, resolvedPaths);
        }
        return resolvedPaths;
    }

    public async isOnTestSourcePath(uri: Uri): Promise<boolean> {
        const workspaceFolder: WorkspaceFolder | undefined = workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            return false;
        }
        const testPaths: ITestSourcePath[] = await this.getTestPaths(workspaceFolder);
        const fsPath: string = uri.fsPath;
        for (const testPath of testPaths) {
            const relativePath: string = path.relative(testPath.testSourcePath, fsPath);
            if (!relativePath.startsWith('..')) {
                return true;
            }
        }
        return false;
    }

    public clear(): void {
        this.testSourceMapping.clear();
        this.additionalTestSourceMapping.clear();
    }

    public delete(workspaceUri: Uri): boolean {
        this.additionalTestSourceMapping.delete(workspaceUri);
        return this.testSourceMapping.delete(workspaceUri);
    }

    private async getTestPaths(workspaceFolder: WorkspaceFolder): Promise<ITestSourcePath[]> {
        let testPaths: ITestSourcePath[] | undefined = this.testSourceMapping.get(workspaceFolder.uri);
        if (!testPaths) {
            testPaths = await getTestSourcePaths([workspaceFolder.uri.toString()]);
            this.testSourceMapping.set(workspaceFolder.uri, testPaths);
        }

        return mergeTestSourcePaths(testPaths, await this.getAdditionalTestSourcePaths(workspaceFolder));
    }
}

export function mergeTestSourcePaths(testPaths: ITestSourcePath[], additionalPaths: string[]): ITestSourcePath[] {
    const mergedPaths: ITestSourcePath[] = [];
    const pathIndexes: Map<string, number> = new Map();
    for (const testPath of testPaths) {
        const key: string = getPathKey(testPath.testSourcePath);
        const existingIndex: number | undefined = pathIndexes.get(key);
        if (existingIndex !== undefined) {
            mergedPaths[existingIndex].isStrict ||= testPath.isStrict;
            continue;
        }

        pathIndexes.set(key, mergedPaths.length);
        mergedPaths.push({ ...testPath });
    }

    for (const additionalPath of additionalPaths) {
        const key: string = getPathKey(additionalPath);
        const existingIndex: number | undefined = pathIndexes.get(key);
        if (existingIndex !== undefined) {
            mergedPaths[existingIndex].isStrict = true;
            continue;
        }

        pathIndexes.set(key, mergedPaths.length);
        mergedPaths.push({ testSourcePath: additionalPath, isStrict: true });
    }
    return mergedPaths;
}

export async function resolveAdditionalTestSourcePaths(workspacePath: string, configuredPaths: string[]): Promise<string[]> {
    const paths: string[] = [];
    const pathKeys: Set<string> = new Set();
    for (const configuredPath of configuredPaths) {
        if (!configuredPath.trim()) {
            continue;
        }

        const normalizedPattern: string = configuredPath.trim().replace(/\\/g, '/');
        const resolvedPattern: string = path.resolve(workspacePath, normalizedPattern);
        if (!hasMagic(normalizedPattern)) {
            addUniquePath(paths, pathKeys, resolvedPattern);
            continue;
        }

        try {
            const matches: { isDirectory(): boolean; fullpath(): string }[] =
                await glob(resolvedPattern.replace(/\\/g, '/'), { withFileTypes: true });
            for (const match of matches) {
                if (match.isDirectory()) {
                    addUniquePath(paths, pathKeys, match.fullpath());
                }
            }
        } catch {
            // Invalid or inaccessible patterns should not prevent test discovery for other paths.
        }
    }
    return paths;
}

function addUniquePath(paths: string[], pathKeys: Set<string>, sourcePath: string): void {
    const key: string = getPathKey(sourcePath);
    if (!pathKeys.has(key)) {
        paths.push(sourcePath);
        pathKeys.add(key);
    }
}

function getPathKey(sourcePath: string): string {
    const normalizedPath: string = path.normalize(sourcePath);
    return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
}

async function getTestSourcePaths(uri: string[]): Promise<ITestSourcePath[]> {
    return await executeJavaLanguageServerCommand<ITestSourcePath[]>(
        JavaTestRunnerDelegateCommands.GET_TEST_SOURCE_PATH, uri) || [];
}

export interface ITestSourcePath {
    testSourcePath: string;
    /**
     * All the source paths from eclipse and invisible project will be treated as test source
     * even they are not marked as test in the classpath entry, in that case, this field will be false.
     */
    isStrict: boolean;
}

export const testSourceProvider: TestSourcePathProvider = new TestSourcePathProvider();
