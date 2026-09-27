// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import * as assert from 'assert';
import * as fse from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { ITestSourcePath, mergeTestSourcePaths, resolveAdditionalTestSourcePaths } from '../../src/provider/testSourceProvider';

suite('testSourceProvider', () => {
    test('returns no extra paths by default', async () => {
        assert.deepStrictEqual(await resolveAdditionalTestSourcePaths(path.resolve('workspace'), []), []);
    });

    test('resolves multiple relative paths against the workspace folder', async () => {
        const workspacePath: string = path.resolve('workspace');
        const sourcePaths: string[] = await resolveAdditionalTestSourcePaths(workspacePath, [
            path.join('src', 'main', 'java'),
            path.join('src', 'integrationTest', 'java'),
        ]);

        assert.deepStrictEqual(sourcePaths, [
            path.resolve(workspacePath, 'src', 'main', 'java'),
            path.resolve(workspacePath, 'src', 'integrationTest', 'java'),
        ]);
    });

    test('deduplicates equivalent Windows path spellings', async () => {
        const workspacePath: string = path.resolve('workspace');
        const relativePath: string = path.join('src', 'main', 'java');
        const sourcePaths: string[] = await resolveAdditionalTestSourcePaths(workspacePath, [
            relativePath,
            relativePath.replace(/\\/g, '/'),
            path.resolve(workspacePath, relativePath),
        ]);

        assert.deepStrictEqual(sourcePaths, [path.resolve(workspacePath, relativePath)]);
    });

    test('merges an additional path already discovered by Java without duplicating it', () => {
        const sourcePath: string = path.resolve('workspace', 'src', 'main', 'java');
        const paths: ITestSourcePath[] = mergeTestSourcePaths(
            [{ testSourcePath: sourcePath, isStrict: false }], [sourcePath]);

        assert.deepStrictEqual(paths, [{ testSourcePath: sourcePath, isStrict: true }]);
    });

    test('expands source-root patterns and deduplicates overlapping matches', async () => {
        const workspacePath: string = fse.mkdtempSync(path.join(os.tmpdir(), 'java-test-source-paths-'));
        const sourceRoots: string[] = [
            path.join(workspacePath, 'modules', 'app', 'src', 'main', 'java'),
            path.join(workspacePath, 'modules', 'cli', 'src', 'main', 'java'),
        ];
        sourceRoots.forEach((sourceRoot: string) => fse.ensureDirSync(sourceRoot));

        try {
            const paths: string[] = await resolveAdditionalTestSourcePaths(workspacePath, [
                'modules/*/src/main/java',
                'modules/app/src/main/java',
            ]);

            assert.deepStrictEqual(paths.sort(), sourceRoots.sort());
        } finally {
            fse.removeSync(workspacePath);
        }
    });

    test('supports Windows separators in source-root patterns', async () => {
        const workspacePath: string = fse.mkdtempSync(path.join(os.tmpdir(), 'java-test-source-paths-'));
        const sourceRoot: string = path.join(workspacePath, 'modules', 'app', 'src', 'main', 'java');
        fse.ensureDirSync(sourceRoot);

        try {
            const paths: string[] = await resolveAdditionalTestSourcePaths(workspacePath, [
                'modules\\*\\src\\main\\java',
            ]);

            assert.deepStrictEqual(paths, [sourceRoot]);
        } finally {
            fse.removeSync(workspacePath);
        }
    });

    test('ignores unmatched source-root patterns', async () => {
        const workspacePath: string = fse.mkdtempSync(path.join(os.tmpdir(), 'java-test-source-paths-'));
        try {
            const paths: string[] = await resolveAdditionalTestSourcePaths(workspacePath, [
                'modules/*/src/test/java',
            ]);

            assert.deepStrictEqual(paths, []);
        } finally {
            fse.removeSync(workspacePath);
        }
    });

    test('ignores blank paths', async () => {
        assert.deepStrictEqual(await resolveAdditionalTestSourcePaths(path.resolve('workspace'), [' ', '\t']), []);
    });
});
