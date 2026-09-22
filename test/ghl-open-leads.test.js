import test from "node:test";
import assert from "node:assert/strict";
import { personalOpenLeads } from "../src/ghl-personal.js";
import { ghlOpsBriefText } from "../src/worker-core.js";
import { executeTool } from "../src/tools.js";
import {
  contactMatchesPhone,
  ghlCheckOpenLeads,
  ghlPhoneEqValues,
  ghlResolveContact,
  ghlSearchContacts,
  hasOpenLeadsTag,
  nameQueryWithoutPhone,
  phoneDigitsFromQuery
} from "../src/ghl.js";

const MICHELLE_ID = "j2MTdDxkLpgUNtORZpjc";
const MICHELLE = {
  id: MICHELLE_ID,
  firstName: "Michelle",
  lastName: "Wang",
  contactName: "Michelle Wang",
  phone: "+13054642363",
  tags: ["active_prospect", "medicare", "prospect"],
  assignedTo: "owner"
};
const MIRIAM = {
  ...MICHELLE,
  firstName: "Miriam",
  lastName: "Wang",
  contactName: "Miriam Wang"
};

function json(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

function flattenFilters(filters = []) {
  return filters.flatMap((filter) => (
    Array.isArray(filter?.filters) ? flattenFilters(filter.filters) : [filter]
  ));
}

function phoneSearchFilter(init) {
  if (!init?.body) return null;
  const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
  return flattenFilters(body.filters).find((filter) => filter?.field === "phone") ?? null;
}

function isContactsSearch(url, init) {
  return String(url).includes("/contacts/search") && (init?.method ?? "GET") === "POST";
}

function isContactsList(url, init) {
  return String(url).includes("/contacts/?") && (init?.method ?? "GET") !== "POST";
}

test("Smart List matches exact tag and owner, excludes removed leads and paginates", async () => {
  let pages = 0;
  const result = await personalOpenLeads({ token: "test", locationId: "loc", userId: "owner", removals: [{subject:"maria lopez"}], fetchImpl: async (url, init) => {
    assert.match(url,/contacts\/search$/);
    const body = JSON.parse(init.body);
    assert.deepEqual(body.filters,[{field:"tags",operator:"eq",value:"active_prospect"},{field:"assignedTo",operator:"eq",value:"owner"}]);
    assert.equal(body.page, ++pages);
    const contact = (id,name,assignedTo="owner",tags=["active_prospect"])=>({id,contactName:name,assignedTo,tags});
    const contacts = pages === 1 ? [contact("removed","María López"),contact("other","Private other lead","other"),contact("wrongtag","Not open","owner",["prospect"]),...Array.from({length:97},(_,i)=>contact(`a${i}`,`Lead ${i}`))] : [contact("last","Last lead")];
    return {ok:true,json:async()=>({contacts,total:101})};
  }});
  assert.equal(pages,2);
  assert.equal(result.leads.length,98);
  assert.equal(result.truncated,false);
  assert(result.leads.some(x=>x.name==="Last lead"));
  const text = ghlOpsBriefText({openLeads:result.leads,tasks:[],appointments:[]});
  assert.match(text,/Open Leads \(GHL Smart List\): 98/);
  assert.doesNotMatch(text,/María|Private|Not open/);
});

test("API failure and malformed data never become a false empty Smart List", async () => {
  for (const response of [{ok:false,status:403,json:async()=>({message:"Forbidden"})},{ok:true,json:async()=>({})}]) {
    await assert.rejects(()=>personalOpenLeads({token:"test",locationId:"loc",userId:"owner",fetchImpl:async()=>response}));
  }
  assert.match(ghlOpsBriefText({openLeadError:"Forbidden",tasks:[],appointments:[]}),/Open leads: unavailable from GHL/);
});

test("Open Leads tag helper accepts active_prospect aliases", () => {
  assert.equal(hasOpenLeadsTag(["medicare", "active_prospect"]), true);
  assert.equal(hasOpenLeadsTag(["active prospect"]), true);
  assert.equal(hasOpenLeadsTag(["prospect"]), false);
});

test("contact search looks up a known GHL contact id instead of treating it as a name", async () => {
  const calls = [];
  const contacts = await ghlSearchContacts({
    token: "test",
    locationId: "RINM4TCnM4hN06UA1aK0",
    query: MICHELLE_ID,
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes(`/contacts/${MICHELLE_ID}`)) return json({ contact: MICHELLE });
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].id, MICHELLE_ID);
  assert.equal(contacts[0].tags.includes("active_prospect"), true);
  assert.equal(calls.some((url) => url.includes(`/contacts/${MICHELLE_ID}`)), true);
});

test("resolve contact falls back from a missed id to name and phone", async () => {
  const calls = [];
  const contact = await ghlResolveContact({
    token: "test",
    locationId: "loc",
    contactId: MICHELLE_ID,
    query: "Michelle W",
    phone: "+13054642363",
    fetchImpl: async (url, init) => {
      calls.push(String(url));
      if (String(url).includes(`/contacts/${MICHELLE_ID}`)) return json({ message: "not found" }, 404);
      if (isContactsSearch(url, init)) {
        const filter = phoneSearchFilter(init);
        assert.equal(filter?.operator, "eq");
        assert.equal(filter?.value, "+13054642363");
        return json({ contacts: [MICHELLE] });
      }
      if (isContactsList(url, init) && String(url).includes("Michelle")) {
        return json({ contacts: [MICHELLE] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  assert.equal(contact.error, undefined);
  assert.equal(contact.id, MICHELLE_ID);
  assert.equal(contact.resolvedVia, "phone");
  assert.equal(calls[0].includes(`/contacts/${MICHELLE_ID}`), true);
});

test("Open Leads check reports on_list after id miss plus name fallback", async () => {
  const result = await ghlCheckOpenLeads({
    token: "test",
    locationId: "loc",
    contactId: MICHELLE_ID,
    query: "Michelle W.",
    fetchImpl: async (url) => {
      if (String(url).includes(`/contacts/${MICHELLE_ID}`)) return json({}, 404);
      if (String(url).includes("/contacts/?")) return json({ contacts: [MICHELLE] });
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  assert.equal(result.status, "on_list");
  assert.equal(result.onOpenLeads, true);
  assert.equal(result.openLeadsTag, "active_prospect");
  assert.equal(result.resolvedVia, "query");
  assert.match(result.message, /on Open Leads/);
});

test("Open Leads check reports not_on_list when the contact exists without the tag", async () => {
  const result = await ghlCheckOpenLeads({
    token: "test",
    locationId: "loc",
    query: "Michelle Wang",
    fetchImpl: async (url) => {
      if (String(url).includes("/contacts/?")) {
        return json({ contacts: [{ ...MICHELLE, tags: ["medicare", "prospect"] }] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  assert.equal(result.status, "not_on_list");
  assert.equal(result.onOpenLeads, false);
  assert.match(result.message, /not on Open Leads/);
});

test("Open Leads check reports not_found after id, name, and phone miss", async () => {
  const result = await ghlCheckOpenLeads({
    token: "test",
    locationId: "loc",
    contactId: MICHELLE_ID,
    query: "Michelle W",
    phone: "+13054642363",
    fetchImpl: async (url, init) => {
      if (String(url).includes(`/contacts/${MICHELLE_ID}`)) return json({ message: "missing" }, 404);
      if (isContactsSearch(url, init) || isContactsList(url, init)) return json({ contacts: [] });
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  assert.equal(result.status, "not_found");
  assert.equal(result.onOpenLeads, false);
  assert.match(result.message, /not found after id, name, and phone/i);
});

test("phone helpers treat last-4 as a match and strip digits from mixed name queries", () => {
  assert.equal(phoneDigitsFromQuery("Miriam 2363"), "2363");
  assert.equal(phoneDigitsFromQuery("Miriam+2363"), "2363");
  assert.equal(nameQueryWithoutPhone("Miriam+2363"), "Miriam");
  assert.equal(contactMatchesPhone(MICHELLE, "2363"), true);
  assert.equal(contactMatchesPhone(MICHELLE, "+13054642363"), true);
  assert.equal(contactMatchesPhone(MICHELLE, "1212"), false);
  assert.equal(ghlPhoneEqValues("3054642363")[0], "+13054642363");
});

function last4SearchFetch(contact = MICHELLE) {
  return async (url, init) => {
    if (isContactsSearch(url, init)) {
      const filter = phoneSearchFilter(init);
      if (filter && String(filter.value).includes("2363")) return json({ contacts: [contact] });
      return json({ contacts: [] });
    }
    if (isContactsList(url, init)) return json({ contacts: [] });
    throw new Error(`Unexpected request: ${url}`);
  };
}

test("contact search matches last-4 via POST search even when GET query is empty", async () => {
  const calls = [];
  const contacts = await ghlSearchContacts({
    token: "test",
    locationId: "loc",
    query: "Miriam 2363",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", filter: phoneSearchFilter(init) });
      if (isContactsList(url, init)) return json({ contacts: [] });
      if (isContactsSearch(url, init)) {
        const filter = phoneSearchFilter(init);
        if (filter && String(filter.value).includes("2363")) return json({ contacts: [MICHELLE] });
        return json({ contacts: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].id, MICHELLE_ID);
  assert.equal(contacts[0].phoneLast4, "2363");
  assert.equal(contacts[0].name, "Michelle W.");
  assert.equal(contacts[0].nameMismatch, true);
  assert.match(contacts[0].hint, /ghl_update_contact/);
  assert.equal(calls.some((call) => call.url.includes("/contacts/search") && call.method === "POST"), true);
  assert.equal(calls.some((call) => call.url.includes("/contacts/?") && String(call.url).includes("2363")), false);
});

test("name search with null list phone still matches last-4 after hydrate", async () => {
  const listHit = { ...MIRIAM, phone: null };
  const contacts = await ghlSearchContacts({
    token: "test",
    locationId: "loc",
    query: "Miriam Wang",
    phone: "2363",
    fetchImpl: async (url, init) => {
      if (isContactsSearch(url, init)) return json({ contacts: [] });
      if (isContactsList(url, init) && /Miriam/i.test(String(url))) {
        return json({ contacts: [listHit] });
      }
      if (String(url).includes(`/contacts/${MICHELLE_ID}`)) return json({ contact: MIRIAM });
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].id, MICHELLE_ID);
  assert.equal(contacts[0].phoneLast4, "2363");
  assert.equal(contacts[0].name, "Miriam W.");
});

test("resolve contact uses last-4 over a first-name mismatch", async () => {
  const contact = await ghlResolveContact({
    token: "test",
    locationId: "loc",
    query: "Miriam",
    phone: "2363",
    fetchImpl: last4SearchFetch(MICHELLE)
  });
  assert.equal(contact.error, undefined);
  assert.equal(contact.id, MICHELLE_ID);
  assert.equal(contact.resolvedVia, "phone");
  assert.equal(contact.phoneLast4, "2363");
});

test("Open Leads check uses last-4 when the stored first name differs", async () => {
  const result = await ghlCheckOpenLeads({
    token: "test",
    locationId: "loc",
    query: "Miriam Wang",
    phone: "2363",
    fetchImpl: last4SearchFetch(MICHELLE)
  });
  assert.equal(result.status, "on_list");
  assert.equal(result.onOpenLeads, true);
  assert.equal(result.resolvedVia, "phone");
  assert.equal(result.contact.id, MICHELLE_ID);
});

test("Open Leads check falls back to a unique first-name hit when the surname is misspelled", async () => {
  const stored = {
    id: MICHELLE_ID,
    firstName: "Miriam",
    lastName: "Wang",
    phone: "+13055552363",
    tags: ["active_prospect"]
  };
  const result = await ghlCheckOpenLeads({
    token: "test",
    locationId: "loc",
    query: "Miriam Wong",
    fetchImpl: async (url) => {
      const query = new URL(String(url)).searchParams.get("query");
      if (query === "Miriam Wong") return json({ contacts: [] });
      if (query === "miriam") return json({ contacts: [stored] });
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  assert.equal(result.status, "on_list");
  assert.equal(result.contact.id, MICHELLE_ID);
  assert.equal(result.resolvedVia, "firstName");
});

test("ghl_search_contacts tool finds a last-4 match with a corrected first name", async () => {
  const result = await executeTool("ghl_search_contacts", {
    query: "Miriam",
    phone: "2363"
  }, {
    environment: { GHL_API_TOKEN: "test", GHL_LOCATION_ID: "loc" },
    fetchImpl: last4SearchFetch(MICHELLE)
  });
  assert.equal(result.contacts.length, 1);
  assert.equal(result.contacts[0].id, MICHELLE_ID);
  assert.equal(result.contacts[0].nameMismatch, true);
});

test("contains last-4 hits are filtered client-side to endsWith", async () => {
  const falsePositive = {
    id: "other-contact",
    firstName: "Other",
    lastName: "Lead",
    phone: "+12363255555",
    tags: []
  };
  const contacts = await ghlSearchContacts({
    token: "test",
    locationId: "loc",
    phone: "2363",
    fetchImpl: async (url, init) => {
      if (isContactsSearch(url, init)) return json({ contacts: [falsePositive, MICHELLE] });
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].id, MICHELLE_ID);
  assert.equal(contacts[0].phoneLast4, "2363");
});

test("ghl_check_open_leads tool uses the Open Leads helper", async () => {
  const result = await executeTool("ghl_check_open_leads", {
    contactId: MICHELLE_ID,
    contactQuery: "Michelle Wang"
  }, {
    environment: { GHL_API_TOKEN: "test", GHL_LOCATION_ID: "RINM4TCnM4hN06UA1aK0" },
    fetchImpl: async (url) => {
      if (String(url).includes(`/contacts/${MICHELLE_ID}`)) return json({ contact: MICHELLE });
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  assert.equal(result.status, "on_list");
  assert.equal(result.contact.id, MICHELLE_ID);
});
