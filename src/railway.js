const RAILWAY_GRAPHQL_URL = "https://backboard.railway.com/graphql/v2";

export function railwayConfig(environment = process.env) {
  return { token: environment.RAILWAY_ACCOUNT_TOKEN };
}

export function railwayReady(config) {
  return Boolean(String(config?.token ?? "").trim());
}

async function railwayRequest({ config, query, variables = {}, fetchImpl = fetch }) {
  if (!railwayReady(config)) throw new Error("RAILWAY_ACCOUNT_TOKEN is not configured.");
  const response = await fetchImpl(RAILWAY_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000)
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Railway API returned HTTP ${response.status} without JSON.`);
  }
  if (!response.ok || payload.errors?.length) {
    const detail = (payload.errors ?? []).map((entry) => entry.message).filter(Boolean).join("; ").slice(0, 500);
    throw new Error(`Railway API failed${detail ? `: ${detail}` : ` with HTTP ${response.status}`}.`);
  }
  return payload.data;
}

export async function listRailwayProjects({ config, fetchImpl = fetch }) {
  const data = await railwayRequest({
    config,
    fetchImpl,
    query: `query { projects { edges { node { id name description createdAt updatedAt } } } }`
  });
  return { projects: (data.projects?.edges ?? []).map((edge) => edge.node) };
}

export async function getRailwayProject({ config, projectId, fetchImpl = fetch }) {
  const data = await railwayRequest({
    config,
    fetchImpl,
    query: `query project($id: String!) {
      project(id: $id) {
        id name description
        services { edges { node { id name } } }
        environments { edges { node { id name } } }
      }
    }`,
    variables: { id: projectId }
  });
  return {
    project: {
      ...data.project,
      services: (data.project?.services?.edges ?? []).map((edge) => edge.node),
      environments: (data.project?.environments?.edges ?? []).map((edge) => edge.node)
    }
  };
}

export async function listRailwayDeployments({ config, projectId, serviceId, environmentId, limit = 10, fetchImpl = fetch }) {
  const data = await railwayRequest({
    config,
    fetchImpl,
    query: `query deployments($input: DeploymentListInput!, $first: Int) {
      deployments(input: $input, first: $first) {
        edges { node { id status createdAt url staticUrl } }
      }
    }`,
    variables: {
      input: { projectId, serviceId, environmentId },
      first: Math.min(Math.max(Number(limit) || 10, 1), 20)
    }
  });
  return { deployments: (data.deployments?.edges ?? []).map((edge) => edge.node) };
}

function redactLogLine(value) {
  return String(value ?? "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[redacted]")
    .replace(/([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|KEY)\s*[=:]\s*)\S+/g, "$1[redacted]")
    .replace(/:\/\/[^\s:@/]+:[^\s@/]+@/g, "://[redacted]@")
    .slice(0, 500);
}

export async function getRailwayLogs({ config, deploymentId, type = "runtime", limit = 50, fetchImpl = fetch }) {
  const build = type === "build";
  const field = build ? "buildLogs" : "deploymentLogs";
  const data = await railwayRequest({
    config,
    fetchImpl,
    query: `query logs($deploymentId: String!, $limit: Int) {
      ${field}(deploymentId: $deploymentId, limit: $limit) { timestamp message severity }
    }`,
    variables: { deploymentId, limit: Math.min(Math.max(Number(limit) || 50, 1), 100) }
  });
  return {
    type: build ? "build" : "runtime",
    logs: (data[field] ?? []).map((entry) => ({ ...entry, message: redactLogLine(entry.message) }))
  };
}

export async function redeployRailwayService({ config, serviceId, environmentId, fetchImpl = fetch }) {
  const data = await railwayRequest({
    config,
    fetchImpl,
    query: `mutation redeploy($serviceId: String!, $environmentId: String!) {
      serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
    }`,
    variables: { serviceId, environmentId }
  });
  return { redeployed: true, deploymentId: data.serviceInstanceRedeploy, serviceId, environmentId };
}

export async function setRailwayVariable({ config, projectId, serviceId, environmentId, name, value, skipDeploys = false, fetchImpl = fetch }) {
  const variableName = String(name ?? "").trim();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(variableName)) throw new Error("Railway variable name must use uppercase letters, numbers, and underscores.");
  if (variableName === "RAILWAY_ACCOUNT_TOKEN") throw new Error("Igor cannot replace his own Railway account token.");
  const data = await railwayRequest({
    config,
    fetchImpl,
    query: `mutation variableUpsert($input: VariableUpsertInput!) { variableUpsert(input: $input) }`,
    variables: { input: { projectId, environmentId, serviceId, name: variableName, value: String(value ?? ""), skipDeploys: Boolean(skipDeploys) } }
  });
  return { updated: data.variableUpsert === true, projectId, serviceId, environmentId, name: variableName, redeployTriggered: !skipDeploys };
}
