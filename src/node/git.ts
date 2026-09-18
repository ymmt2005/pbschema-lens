import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export async function detectGitInfo(cwd: string): Promise<{ commit?: string; repository?: string }> {
  try {
    const { stdout: commit } = await exec("git", ["rev-parse", "HEAD"], { cwd });
    let repository: string | undefined;
    try {
      const { stdout: remote } = await exec("git", ["remote", "get-url", "origin"], { cwd });
      repository = normalizeRemote(remote.trim());
    } catch {
      repository = undefined;
    }
    return { commit: commit.trim(), repository };
  } catch {
    return {};
  }
}

function normalizeRemote(remote: string): string {
  const ssh = remote.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (ssh) {
    return `github:${ssh[1]}`;
  }
  const https = remote.match(/^https?:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (https) {
    return `github:${https[1]}`;
  }
  return remote;
}
