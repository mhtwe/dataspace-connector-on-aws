// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { join } from "path";

import {
  DeploymentConfig,
  loadDeploymentConfig,
  loadPipelineConfig,
  PersistenceType,
} from "../lib/config/config";
import { PipelineStack, runtimeJarTasks } from "../lib/pipeline-stack";

const CONFIG_PATH = join(__dirname, "..", "config-templates");
const env = { account: "111111111111", region: "eu-central-1" };

/** The bundled templates with one connector per given persistence type. */
function config(...types: PersistenceType[]): DeploymentConfig {
  const loaded = loadDeploymentConfig(CONFIG_PATH);
  return {
    ...loaded,
    connectors: types.map((persistence, i) => ({
      ...loaded.connectors[0],
      connectorId: `conn-${i}`,
      persistence,
    })),
  };
}

/** The shell commands of the Synth CodeBuild project. */
function synthCommands(deploymentConfig: DeploymentConfig): string[] {
  const stack = new PipelineStack(new App(), "Pipeline", {
    pipelineConfig: loadPipelineConfig(CONFIG_PATH),
    deploymentConfig,
    env,
  });
  const buildSpecs = Object.values(
    Template.fromStack(stack).findResources("AWS::CodeBuild::Project"),
  ).map((r) => JSON.stringify(r.Properties.Source.BuildSpec));
  const synth = buildSpecs.find((spec) => spec.includes("cdk synth"));
  expect(synth).toBeDefined();
  return Object.values(JSON.parse(JSON.parse(synth!)).phases).flatMap(
    (phase) => (phase as { commands: string[] }).commands,
  );
}

const gradleCommand = (deploymentConfig: DeploymentConfig) =>
  synthCommands(deploymentConfig).filter((c) => c.includes("gradlew"));

describe("runtimeJarTasks", () => {
  test.each([
    [["dynamodb"], ["shadowJar"]],
    [["aurora"], ["postgresShadowJar"]],
    [
      ["dynamodb", "aurora"],
      ["shadowJar", "postgresShadowJar"],
    ],
    [[], []],
  ] as [PersistenceType[], string[]][])("%j -> %j", (types, tasks) => {
    expect(runtimeJarTasks(new Set(types))).toEqual(tasks);
  });
});

describe("PipelineStack Synth step", () => {
  test("dynamodb only: renders the unchanged command", () => {
    expect(gradleCommand(config("dynamodb", "dynamodb"))).toEqual([
      "cd edc && ./gradlew clean shadowJar",
    ]);
  });

  test("aurora only: builds the PostgreSQL jars alone", () => {
    expect(gradleCommand(config("aurora", "aurora"))).toEqual([
      "cd edc && ./gradlew clean postgresShadowJar",
    ]);
  });

  test("mixed: builds both variants in one Gradle invocation", () => {
    expect(gradleCommand(config("aurora", "dynamodb"))).toEqual([
      "cd edc && ./gradlew clean shadowJar postgresShadowJar",
    ]);
  });
});
