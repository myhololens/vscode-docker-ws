import { v4 as uuid } from 'uuid';
import * as vscode from 'vscode';
import { Container } from './docker/container';
import { Containers } from './docker/containers';
import { detectFileType, FileStat } from './utils/filetype';

export namespace fileCommands {
    export async function readlink(containerId: string, path: string): Promise<string> {
        const buf = await (await Containers.find(containerId)).exec('readlink', '-f', path);
        return buf.toString().trim();
    }

    const STAT_COMMAND = ['env', 'stat', '-c', '%n|%f|%s|%Z'];

    export async function stat(container: string | Container, path: string, followSymlink: boolean = false, encoding: string = 'utf8'): Promise<FileStat> {
        if (typeof container === 'string') {
            container = await Containers.find(container);
        }
        let command = STAT_COMMAND;
        if (followSymlink) {
            command = command.concat('-L');
        }
        const statOutput = await container.exec(...command, path);
        return parseStat(container, statOutput.toString(encoding).split('|'));
    }

    export async function ls(containerId: string, path: string, encoding: string = 'utf8'): Promise<[string, vscode.FileType][]> {
        const container = await Containers.find(containerId);

        const lsOutput = await container.exec('env', 'ls', '-A', path);

        const fileNames = lsOutput.toString(encoding).split('\n').filter(l => l.length > 0).map(
            f => `${path === '/' ? '' : path}/${f}`);

        if (fileNames.length === 0) {
            return [];
        }

        const fileList: [string, vscode.FileType][] = [];

        const statLines = await container.exec(...STAT_COMMAND, ...fileNames);

        for (let line of statLines.toString(encoding).split('\n').filter(l => l.length > 0)) {
            const stat = await parseStat(container, line.split('|'));
            fileList.push([stat.name, stat.type]);
        }

        return fileList;
    }

    async function parseStat(container: Container, [name, mode, size, mtime]: string[]): Promise<FileStat> {
        let type = detectFileType(parseInt(mode, 16));

        if (type === vscode.FileType.SymbolicLink) {
            const followedSymlinkStat = await stat(container, name, true);
            type = vscode.FileType.SymbolicLink | followedSymlinkStat.type;
        }

        return new FileStat(
            name,
            parseInt(mode, 16),
            type,
            parseInt(size) || 0,
            parseInt(mtime) || 0,
            parseInt(mtime) || 0,
        );
    }

    export async function mkdir(containerId: string, path: string): Promise<void> {
        const container = await Containers.find(containerId);
        await container.exec('env', 'mkdir', path);
    }

    export async function cat(containerId: string, path: string): Promise<Buffer> {
        const container = await Containers.find(containerId);
        return await container.exec('env', 'cat', path);
    }

    export async function echo(containerId: string, path: string, content: Uint8Array): Promise<void> {
        const container = await Containers.find(containerId);
        const delimiter = uuid();
        await container.exec('sh', '-c', `head -c -1 <<'${delimiter}' > '${path}'
${content}
${delimiter}`);
    }

    export async function rm(containerId: string, path: string, options: { recursive: boolean; }) {
        const container = await Containers.find(containerId);
        const commands = ['env', 'rm', '-f'];
        if (options.recursive) {
            commands.push('-r');
        }
        await container.exec(...commands, path);
    }

    export async function mv(containerId: string, oldPath: string, newPath: string, options: { overwrite: boolean; }) {
        const container = await Containers.find(containerId);
        const commands = ['env', 'mv'];
        if (options.overwrite) {
            commands.push('-f');
        }
        await container.exec(...commands, oldPath, newPath);
    }

    export async function cp(containerId: string, source: string, destination: string, options: { overwrite: boolean; }) {
        const container = await Containers.find(containerId);
        const commands = ['env', 'cp'];
        if (options.overwrite) {
            commands.push('-f');
        }
        await container.exec(...commands, source, destination);
    }
}
