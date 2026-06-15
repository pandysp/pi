import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "../src/core/extensions/types.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("AgentSession executable tool access", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-executable-tools-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("exposes another extension's active tool as an executable object", async () => {
		const settingsManager = SettingsManager.create(tempDir, agentDir);
		const sessionManager = SessionManager.inMemory();

		let observer: ExtensionAPI | undefined;

		const resourceLoader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir,
			settingsManager,
			extensionFactories: [
				(pi) => {
					pi.on("session_start", () => {
						pi.registerTool({
							name: "ping",
							label: "Ping",
							description: "Returns pong",
							parameters: Type.Object({}),
							execute: async () => ({
								content: [{ type: "text", text: "pong" }],
								details: {},
							}),
						});
					});
				},
				(pi) => {
					observer = pi;
				},
			],
		});
		await resourceLoader.reload();

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir,
			model: getModel("anthropic", "claude-sonnet-4-5")!,
			settingsManager,
			sessionManager,
			resourceLoader,
		});

		await session.bindExtensions({});

		expect(observer).toBeDefined();
		const pi = observer!;

		expect(pi.getActiveTools()).toContain("ping");

		// getAllTools() projects to ToolInfo, which has no execute.
		const pingInfo = pi.getAllTools().find((tool) => tool.name === "ping");
		expect(pingInfo).toBeDefined();
		expect("execute" in (pingInfo as Record<string, unknown>)).toBe(false);

		const executableTools = pi.getActiveExecutableTools();
		expect(executableTools.map((tool) => tool.name)).toContain("ping");

		const ping = executableTools.find((tool) => tool.name === "ping");
		expect(ping).toBeDefined();
		expect(typeof ping!.execute).toBe("function");

		const result = await ping!.execute("test-call-1", {});
		expect(result.content).toEqual([{ type: "text", text: "pong" }]);

		expect(executableTools.map((tool) => tool.name)).toEqual(pi.getActiveTools());

		session.dispose();
	});
});
