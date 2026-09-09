import assert from "node:assert/strict";
import test from "node:test";
import {
  getRailwayLogs,
  listRailwayProjects,
  railwayConfig,
  redeployRailwayService,
  setRailwayVariable
} from "../src/railway.js";

const config = { token: "railway-token" };

function response(data) {
  return { ok: true, status: 200, json: async () => ({ data }) };
}

test("Railway uses the account token and lists projects", async () => {
  let request;
  let calls = 0;
  const result = await listRailwayProjects({
    config,
    fetchImpl: async (url, options) => {
      request = { url, options };
      calls += 1;
      if (calls === 1) {
        return response({
          me: { workspaces: [{ id: "w1", name: "yperez-dot's Projects" }] },
          projects: { edges: [] }
        });
      }
      return response({ projects: { edges: [{ node: { id: "p1", name: "Agent Medicare Hub" } }] } });
    }
  });
  assert.equal(request.url, "https://backboard.railway.com/graphql/v2");
  assert.equal(request.options.headers.Authorization, "Bearer railway-token");
  assert.equal(result.projects[0].name, "Agent Medicare Hub");
  assert.equal(result.projects[0].workspace.name, "yperez-dot's Projects");
  assert.equal(calls, 2);
});

test("Railway log output redacts credentials", async () => {
  const result = await getRailwayLogs({
    config,
    deploymentId: "d1",
    fetchImpl: async () => response({
      deploymentLogs: [{ timestamp: "now", severity: "error", message: "OPENAI_API_KEY=sk-secret password postgres://user:pass@host/db" }]
    })
  });
  assert.doesNotMatch(result.logs[0].message, /sk-secret|user:pass/);
  assert.match(result.logs[0].message, /\[redacted\]/);
});

test("Railway writes are narrowly scoped and never return variable values", async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return response(requests.length === 1 ? { serviceInstanceRedeploy: "d2" } : { variableUpsert: true });
  };
  const deploy = await redeployRailwayService({ config, serviceId: "s1", environmentId: "e1", fetchImpl });
  assert.equal(deploy.deploymentId, "d2");
  const variable = await setRailwayVariable({
    config, projectId: "p1", serviceId: "s1", environmentId: "e1", name: "SITE_MODE", value: "live", fetchImpl
  });
  assert.equal(variable.updated, true);
  assert.equal(Object.hasOwn(variable, "value"), false);
  await assert.rejects(
    setRailwayVariable({ config, projectId: "p1", serviceId: "s1", environmentId: "e1", name: "RAILWAY_ACCOUNT_TOKEN", value: "new", fetchImpl }),
    /cannot replace/
  );
});

test("railwayConfig reads only the explicit account token", () => {
  assert.deepEqual(railwayConfig({ RAILWAY_ACCOUNT_TOKEN: "token" }), { token: "token" });
});
