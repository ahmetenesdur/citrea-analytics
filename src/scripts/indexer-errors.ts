#!/usr/bin/env tsx

import "dotenv/config";
import type Database from "better-sqlite3";
import { pathToFileURL } from "node:url";
import { initDatabase } from "../database";
import { NETWORKS } from "../config/networks";
import {
	listIndexerErrors,
	resolveIndexerError,
	type IndexerErrorStatus,
	type IndexerErrorSummary,
} from "../services/indexer-observability";

type IndexerErrorsCommand = "list" | "resolve" | "ignore";

export interface ParsedIndexerErrorsArgs {
	command: IndexerErrorsCommand;
	network: string;
	status?: IndexerErrorStatus;
	limit: number;
	id?: number;
}

export interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

const VALID_COMMANDS: IndexerErrorsCommand[] = ["list", "resolve", "ignore"];
const VALID_STATUSES: IndexerErrorStatus[] = ["open", "resolved", "ignored"];

function readOption(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index === -1) return undefined;
	return args[index + 1];
}

function parseLimit(value: string | undefined): number {
	if (value === undefined) return 25;
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 25;
}

function parseId(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseStatus(value: string | undefined): IndexerErrorStatus | undefined {
	if (value === undefined) return "open";
	if (VALID_STATUSES.includes(value as IndexerErrorStatus)) {
		return value as IndexerErrorStatus;
	}
	throw new Error(`Invalid status '${value}'. Expected: ${VALID_STATUSES.join(", ")}`);
}

export function parseIndexerErrorsArgs(args: string[]): ParsedIndexerErrorsArgs {
	const commandArg = args.find((arg) => !arg.startsWith("--")) ?? "list";
	if (!VALID_COMMANDS.includes(commandArg as IndexerErrorsCommand)) {
		throw new Error(`Invalid command '${commandArg}'. Expected: ${VALID_COMMANDS.join(", ")}`);
	}

	const command = commandArg as IndexerErrorsCommand;
	const commandIndex = args.indexOf(commandArg);
	const id = command === "list" ? undefined : parseId(args[commandIndex + 1]);
	if (command !== "list" && id === undefined) {
		throw new Error(`Command '${command}' requires a positive numeric error id`);
	}

	const parsed: ParsedIndexerErrorsArgs = {
		command,
		network: readOption(args, "--network") ?? "citrea",
		limit: parseLimit(readOption(args, "--limit")),
	};
	const status = parseStatus(readOption(args, "--status"));
	if (status !== undefined) parsed.status = status;
	if (id !== undefined) parsed.id = id;
	return parsed;
}

function formatErrors(errors: IndexerErrorSummary[]): string {
	if (errors.length === 0) return "No indexer errors found.";
	const lines = ["ID\tSTATUS\tRETRY\tSTAGE\tTX/ITEM\tLAST_SEEN\tMESSAGE"];
	for (const error of errors) {
		const subject =
			error.txHash ?? error.item ?? `${error.blockStart ?? "?"}-${error.blockEnd ?? "?"}`;
		lines.push(
			[
				error.id,
				error.status,
				error.retryCount,
				error.stage,
				subject,
				error.lastSeenAt,
				error.errorMessage,
			].join("\t")
		);
	}
	return lines.join("\n");
}

export function runIndexerErrorsCommand(db: Database.Database, args: string[]): CommandResult {
	try {
		const parsed = parseIndexerErrorsArgs(args);
		if (parsed.command === "list") {
			const options: { status?: IndexerErrorStatus; limit?: number } = {
				limit: parsed.limit,
			};
			if (parsed.status !== undefined) options.status = parsed.status;
			return {
				exitCode: 0,
				stdout: formatErrors(listIndexerErrors(db, options)),
				stderr: "",
			};
		}

		resolveIndexerError(db, parsed.id!, parsed.command === "resolve" ? "resolved" : "ignored");
		return {
			exitCode: 0,
			stdout: `Indexer error ${parsed.id} marked as ${parsed.command === "resolve" ? "resolved" : "ignored"}.`,
			stderr: "",
		};
	} catch (error) {
		return {
			exitCode: 1,
			stdout: "",
			stderr: error instanceof Error ? error.message : String(error),
		};
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const parsed = parseIndexerErrorsArgs(args);
	const config = NETWORKS[parsed.network];
	if (!config) {
		console.error(
			`Unknown network '${parsed.network}'. Available: ${Object.keys(NETWORKS).join(", ")}`
		);
		process.exit(1);
	}

	const db = initDatabase(config.dbFile);
	try {
		const result = runIndexerErrorsCommand(db, args);
		if (result.stdout) console.log(result.stdout);
		if (result.stderr) console.error(result.stderr);
		process.exitCode = result.exitCode;
	} finally {
		db.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	void main();
}
