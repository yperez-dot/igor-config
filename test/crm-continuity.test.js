import assert from "node:assert/strict";
import test from "node:test";
import { handleTelegramChat } from "../src/chat.js";
import {
  applyCrmToolResult,
  explicitCrmContactOverride,
  extractLast4FromText,
  extractNamedContact,
  formatActiveCrmTask,
  ghlTaskPreviewArgs,
  isAffirmative,
  isLookItUp,
  isThreadContactReference,
  lookupArgsFromScratch,
  maybeContinueCrmTask,
  mergeThreadIdentifiers,
  parseGhlTaskDraft,
  switchesAwayFromCrm,
  parseNameCorrection
} from "../src/crm-continuity.js";

test("email requests switch away from stale CRM continuity", () => {
  assert.equal(switchesAwayFromCrm("Look through the emails that I sent last week to David Grossman."), true);
  assert.equal(switchesAwayFromCrm("Look it up in GHL"), false);
});
import { isPlanRecommendationRequest, recommendationRefusal } from "../src/grok.js";

const yahoska = { role: "yahoska", name: "Yahoska Perez" };

const pendingNote = {
  contactId: "contact-michelle-1",
  spokenName: "Michelle",
  storedName: "Michelle W.",
  phoneLast4: "2363",
  goal: "add_note",
  pending: {
    tool: "ghl_add_contact_note",
    approved: false,
    args: {
      contactId: "contact-michelle-1",
      phone: "2363",
      body: "Alexa’s grandma referred her. Appointment details from the photo."
    }
  }
};

function memoryStore(seedScratch = null) {
  const turns = [];
  const scratch = new Map();
  if (seedScratch) scratch.set("99:crm", seedScratch);
  return {
    turns,
    scratch,
    async recentChatTurns() {
      return turns.map(({ role, content }) => ({ role, content }));
    },
    async appendChatTurn(turn) {
      turns.push(turn);
    },
    async saveChatScratch(chatId, kind, payload) {
      scratch.set(`${chatId}:${kind}`, payload);
      return payload;
    },
    async getChatScratch(chatId, kind = "crm") {
      return scratch.get(`${chatId}:${kind}`) ?? null;
    }
  };
}

async function chatTurn({ store, text, executeTool, askGrok }) {
  let grokCalled = false;
  const toolCalls = [];
  const sent = [];
  const reply = await handleTelegramChat({
    store,
    message: { chatId: 99, senderId: "111", firstName: "Yahoska", text },
    askGrok: async (request) => {
      grokCalled = true;
      return askGrok ? askGrok(request) : "should not run";
    },
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return executeTool ? executeTool(name, args, toolCalls) : { ok: true };
    },
    sendTelegramMessage: async (payload) => { sent.push(payload.text); },
    botToken: "token",
    apiKey: "xai",
    model: "grok-4.6",
    isPlanRecommendationRequest,
    recommendationRefusal,
    unavailableMessage: () => "offline",
    environment: { TELEGRAM_YAHOSKA_USER_ID: "111" }
  });
  return { reply, grokCalled, toolCalls, sent };
}

test("affirmative, look-it-up, and name-correction helpers match the live thread", () => {
  assert.equal(isAffirmative("Yes"), true);
  assert.equal(isAffirmative("sí"), true);
  assert.equal(isAffirmative("ok"), true);
  assert.equal(isAffirmative("do it"), true);
  assert.equal(isAffirmative("Look it up Igor"), false);
  assert.equal(isLookItUp("Look it up Igor"), true);
  assert.equal(isLookItUp("look her up"), true);
  const correction = parseNameCorrection("Her name is actually Miriam not Michelle");
  assert.equal(correction.firstName, "Miriam");
  assert.equal(correction.previousFirstName, "Michelle");
  assert.equal(extractLast4FromText("2363"), "2363");
  assert.equal(extractLast4FromText("Miriam 2363"), "2363");
  assert.equal(extractLast4FromText("last 4 is 2363"), "2363");
  assert.equal(extractLast4FromText("check 2026 AEP"), "");
});

test("thread identifiers and lookup args reuse last-4 and contact id", () => {
  const merged = mergeThreadIdentifiers(
    { spokenName: "Michelle" },
    [{ role: "user", content: "last 4 is 2363" }],
    "Look it up"
  );
  assert.equal(merged.phoneLast4, "2363");
  const args = lookupArgsFromScratch({
    contactId: "contact-michelle-1",
    phoneLast4: "2363",
    spokenName: "Miriam"
  });
  assert.deepEqual(args, {
    contactId: "contact-michelle-1",
    phone: "2363",
    query: "Miriam",
    contactQuery: "Miriam"
  });
  const packed = formatActiveCrmTask(pendingNote);
  assert.match(packed, /Active CRM task/);
  assert.match(packed, /contact-michelle-1/);
  assert.match(packed, /2363/);
  assert.match(packed, /Alexa’s grandma referred her/);
  assert.match(packed, /that contact/);
  assert.match(packed, /Do not re-search by name/);
});

test("note preview result sticks the contact id and draft on the scratchpad", () => {
  const next = applyCrmToolResult(null, "ghl_add_contact_note", {
    contactQuery: "Michelle",
    phone: "2363",
    body: "Alexa’s grandma referred her."
  }, {
    needsConfirmation: true,
    proposed: {
      contact: "Michelle W.",
      contactId: "contact-michelle-1",
      phoneLast4: "2363",
      body: "Alexa’s grandma referred her."
    }
  });
  assert.equal(next.contactId, "contact-michelle-1");
  assert.equal(next.phoneLast4, "2363");
  assert.equal(next.pending.tool, "ghl_add_contact_note");
  assert.equal(next.pending.args.body, "Alexa’s grandma referred her.");
});

test("after draft + Yes, confirmed write is attempted on the same note", async () => {
  const result = await maybeContinueCrmTask({
    text: "Yes",
    history: [
      { role: "assistant", content: "Drafted the GHL note. Say yes and I’ll save it." }
    ],
    scratch: pendingNote,
    speaker: yahoska,
    executeTool: async (name, args) => {
      assert.equal(name, "ghl_add_contact_note");
      assert.equal(args.confirmed, true);
      assert.equal(args.contactId, "contact-michelle-1");
      assert.equal(args.body, pendingNote.pending.args.body);
      return { created: true, contactId: "contact-michelle-1", contact: "Michelle W." };
    }
  });
  assert.match(result.reply, /Saved the note/);
  assert.match(result.reply, /GHL/);
  assert.equal(result.scratch.pending, null);
});

test("name correction updates the known contact and continues the approved note", async () => {
  const toolCalls = [];
  const result = await maybeContinueCrmTask({
    text: "Her name is actually Miriam not Michelle",
    history: [
      { role: "user", content: "Yes" },
      { role: "assistant", content: "I still have the draft — couldn’t find Michelle by name." }
    ],
    scratch: {
      ...pendingNote,
      pending: { ...pendingNote.pending, approved: true }
    },
    speaker: yahoska,
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      if (name === "ghl_update_contact") {
        assert.equal(args.confirmed, true);
        assert.equal(args.contactId, "contact-michelle-1");
        assert.equal(args.phone, "2363");
        assert.equal(args.firstName, "Miriam");
        return { updated: true, contactId: "contact-michelle-1", contact: "Miriam W.", firstName: "Miriam" };
      }
      assert.equal(name, "ghl_add_contact_note");
      assert.equal(args.confirmed, true);
      assert.equal(args.body, pendingNote.pending.args.body);
      return { created: true, contactId: "contact-michelle-1", contact: "Miriam W." };
    }
  });
  assert.deepEqual(toolCalls.map((call) => call.name), ["ghl_update_contact", "ghl_add_contact_note"]);
  assert.match(result.reply, /Miriam/);
  assert.match(result.reply, /saved the note/i);
  assert.doesNotMatch(result.reply, /NOTION UPDATED/);
});

test("look it up uses prior last-4 and contact id without re-asking", async () => {
  const toolCalls = [];
  const result = await maybeContinueCrmTask({
    text: "Look it up Igor",
    history: [
      { role: "user", content: "2363" },
      { role: "assistant", content: "I need the GHL contact id." }
    ],
    scratch: {
      contactId: "contact-michelle-1",
      spokenName: "Miriam",
      phoneLast4: "2363",
      goal: "open_leads",
      pending: pendingNote.pending
    },
    speaker: yahoska,
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      if (name === "ghl_search_contacts") {
        assert.equal(args.contactId, "contact-michelle-1");
        assert.equal(args.phone, "2363");
        assert.equal(Object.hasOwn(args, "pleasePasteId"), false);
        return {
          contacts: [{
            id: "contact-michelle-1",
            name: "Miriam W.",
            phoneLast4: "2363",
            nameMismatch: false
          }]
        };
      }
      assert.equal(name, "ghl_check_open_leads");
      assert.equal(args.contactId, "contact-michelle-1");
      return { status: "on_list", contact: { id: "contact-michelle-1", name: "Miriam W.", phoneLast4: "2363" } };
    }
  });
  assert.equal(toolCalls[0].name, "ghl_search_contacts");
  assert.match(result.reply, /Found Miriam W/);
  assert.match(result.reply, /2363/);
  assert.match(result.reply, /Open Leads/);
  assert.doesNotMatch(result.reply, /paste/i);
  assert.doesNotMatch(result.reply, /contact id/i);
});

test("Telegram Yes after a drafted GHL note calls the confirmed write", async () => {
  const store = memoryStore(pendingNote);
  store.turns.push({
    role: "assistant",
    content: "Here’s the GHL note for Michelle W. Say yes and I’ll save it."
  });
  const { reply, grokCalled, toolCalls } = await chatTurn({
    store,
    text: "Yes",
    executeTool: async (name, args) => {
      assert.equal(name, "ghl_add_contact_note");
      assert.equal(args.confirmed, true);
      assert.equal(args.body, pendingNote.pending.args.body);
      return { created: true, contactId: "contact-michelle-1", contact: "Michelle W." };
    }
  });
  assert.equal(grokCalled, false);
  assert.equal(toolCalls[0].args.confirmed, true);
  assert.match(reply, /Saved the note/);
  assert.equal(store.scratch.get("99:crm").pending, null);
});

test("Telegram name correction continues the pending approved note", async () => {
  const store = memoryStore({
    ...pendingNote,
    pending: { ...pendingNote.pending, approved: true }
  });
  const { reply, grokCalled, toolCalls } = await chatTurn({
    store,
    text: "Her name is actually Miriam not Michelle",
    executeTool: async (name, args) => {
      if (name === "ghl_update_contact") {
        return { updated: true, contactId: args.contactId, contact: "Miriam W.", firstName: "Miriam" };
      }
      return { created: true, contactId: args.contactId, contact: "Miriam W." };
    }
  });
  assert.equal(grokCalled, false);
  assert.equal(toolCalls[0].name, "ghl_update_contact");
  assert.equal(toolCalls[1].name, "ghl_add_contact_note");
  assert.equal(toolCalls[1].args.confirmed, true);
  assert.match(reply, /saved the note/i);
});

test("Telegram look-it-up packs prior identifiers and does not ask Grok for a contact id", async () => {
  const store = memoryStore({
    contactId: "contact-michelle-1",
    spokenName: "Michelle",
    phoneLast4: "2363",
    pending: pendingNote.pending
  });
  store.turns.push({ role: "user", content: "2363" });
  const { reply, grokCalled, toolCalls } = await chatTurn({
    store,
    text: "Look it up Igor",
    executeTool: async (name, args) => {
      if (name === "ghl_search_contacts") {
        assert.equal(args.phone, "2363");
        assert.equal(args.contactId, "contact-michelle-1");
        return { contacts: [{ id: "contact-michelle-1", name: "Michelle W.", phoneLast4: "2363" }] };
      }
      return {};
    }
  });
  assert.equal(grokCalled, false);
  assert.equal(toolCalls[0].name, "ghl_search_contacts");
  assert.doesNotMatch(reply, /paste/i);
  assert.match(reply, /Found Michelle W/);
});

test("active CRM scratch is packed into Grok’s system prompt on a follow-up", async () => {
  const store = memoryStore({
    contactId: "contact-michelle-1",
    spokenName: "Michelle",
    phoneLast4: "2363",
    pending: pendingNote.pending
  });
  let prompt = "";
  const { grokCalled } = await chatTurn({
    store,
    text: "also check Open Leads",
    askGrok: (request) => {
      prompt = request.systemPrompt;
      return "Checking Open Leads on that same contact.";
    },
    executeTool: async () => ({ status: "on_list" })
  });
  assert.equal(grokCalled, true);
  assert.match(prompt, /Active CRM task/);
  assert.match(prompt, /contact-michelle-1/);
  assert.match(prompt, /2363/);
  assert.match(prompt, /Follow the thread/);
});

test("sent-email search does not reuse the prior CRM contact", async () => {
  const store = memoryStore({
    contactId: "contact-sandra-1",
    spokenName: "Sandra",
    storedName: "Sandra C.",
    phoneLast4: "0534",
    goal: "crm"
  });
  let prompt = "";
  const { grokCalled, toolCalls, reply } = await chatTurn({
    store,
    text: "Look through the emails that I sent. There’s one that I sent last week to David Grossman. Let me know if you can find it.",
    askGrok: (request) => {
      prompt = request.systemPrompt;
      return "I’ll search your sent email from last week for David Grossman.";
    },
    executeTool: async () => {
      throw new Error("stale CRM continuation must not call a GHL tool");
    }
  });
  assert.equal(grokCalled, true);
  assert.equal(toolCalls.length, 0);
  assert.doesNotMatch(prompt, /## Active CRM task \(this Telegram chat\)/);
  assert.match(prompt, /not a CRM continuation/i);
  assert.doesNotMatch(reply, /Sandra|0534/);
  assert.match(reply, /David Grossman/);
});

test("email follow-up confirmation stays on email instead of stale CRM", async () => {
  const store = memoryStore({
    contactId: "contact-sandra-1",
    storedName: "Sandra C.",
    phoneLast4: "0534",
    goal: "crm"
  });
  store.turns.push({
    role: "assistant",
    content: "I found your September 16 email to David Grossman. What should the follow-up email say?"
  });
  let prompt = "";
  const { grokCalled, toolCalls, reply } = await chatTurn({
    store,
    text: "Yes let’s ask if he was able to review it and if he has any questions",
    askGrok: (request) => {
      prompt = request.systemPrompt;
      return "I’ll draft that follow-up in the David Grossman email thread.";
    },
    executeTool: async () => {
      throw new Error("email confirmation must not call a stale CRM tool");
    }
  });
  assert.equal(grokCalled, true);
  assert.equal(toolCalls.length, 0);
  assert.doesNotMatch(prompt, /## Active CRM task \(this Telegram chat\)/);
  assert.match(prompt, /not a CRM continuation/i);
  assert.doesNotMatch(reply, /Sandra|0534/);
  assert.match(reply, /David Grossman/);
});

test("that-contact phrasing reuses the pinned GHL id and does not name-search", () => {
  const scratch = {
    contactId: "contact-michelle-1",
    spokenName: "Michelle",
    storedName: "Michelle W.",
    phoneLast4: "2363"
  };
  assert.equal(isThreadContactReference("Create a GHL task on that contact due tomorrow"), true);
  assert.equal(isThreadContactReference("create a task on them due tomorrow"), true);
  assert.equal(isThreadContactReference("follow-up task for her tomorrow"), true);
  assert.equal(extractNamedContact("Create a GHL task on that contact due tomorrow"), "");
  assert.equal(extractNamedContact("create a task on them due tomorrow"), "");
  assert.equal(extractNamedContact("create a GHL task on David Grossman due Friday"), "David Grossman");
  assert.equal(explicitCrmContactOverride("Create a GHL task on that contact due tomorrow", scratch), null);
  assert.equal(explicitCrmContactOverride("create a task on Michelle due tomorrow", scratch), null);
  assert.equal(explicitCrmContactOverride("create a GHL task on David Grossman due Friday", scratch).contactQuery, "David Grossman");
  assert.equal(explicitCrmContactOverride("create a task on 305-555-0199", scratch).phone.includes("5550199"), true);
  assert.equal(parseGhlTaskDraft("Create a GHL task on that contact due tomorrow", scratch).contactQuery, "");
  const pinned = ghlTaskPreviewArgs("Create a GHL task on that contact due tomorrow", scratch);
  assert.equal(pinned.mode, "thread-id");
  assert.deepEqual(pinned.args, {
    contactId: "contact-michelle-1",
    title: "Follow up",
    dueDate: pinned.args.dueDate
  });
  assert.equal(Object.hasOwn(pinned.args, "contactQuery"), false);
  const switched = ghlTaskPreviewArgs("create a GHL task on David Grossman due Friday", scratch);
  assert.equal(switched.mode, "search");
  assert.equal(switched.args.contactQuery, "David Grossman");
  assert.equal(Object.hasOwn(switched.args, "contactId"), false);
});

test("create GHL task on the known contact previews ghl_create_contact_task, not calendar", async () => {
  const store = memoryStore({
    contactId: "contact-michelle-1",
    spokenName: "Michelle",
    storedName: "Michelle W.",
    phoneLast4: "2363",
    goal: "add_note"
  });
  const { grokCalled, toolCalls, reply } = await chatTurn({
    store,
    text: "Create a GHL task on that contact due tomorrow",
    executeTool: async (name, args) => {
      assert.equal(name, "ghl_create_contact_task");
      assert.equal(args.contactId, "contact-michelle-1");
      assert.equal(args.contactQuery, undefined);
      assert.equal(args.phone, undefined);
      assert.equal(args.confirmed, undefined);
      return {
        needsConfirmation: true,
        proposed: {
          contact: "Michelle W.",
          contactId: "contact-michelle-1",
          title: args.title,
          dueDate: args.dueDate
        }
      };
    }
  });
  assert.equal(grokCalled, false);
  assert.deepEqual(toolCalls.map((call) => call.name), ["ghl_create_contact_task"]);
  assert.match(reply, /GHL task/);
  assert.match(reply, /Michelle W/);
  assert.match(reply, /not a calendar event/i);
});

test("them/him/her on a pinned contact still previews that same GHL id", async () => {
  const result = await maybeContinueCrmTask({
    text: "create a GHL task on them due tomorrow",
    history: [{ role: "assistant", content: "Saved the note on Michelle W. in GHL." }],
    scratch: {
      contactId: "contact-michelle-1",
      spokenName: "Michelle",
      storedName: "Michelle W.",
      phoneLast4: "2363",
      goal: "add_note"
    },
    speaker: yahoska,
    executeTool: async (name, args) => {
      assert.equal(name, "ghl_create_contact_task");
      assert.equal(args.contactId, "contact-michelle-1");
      assert.equal(Object.hasOwn(args, "contactQuery"), false);
      return {
        needsConfirmation: true,
        proposed: { contact: "Michelle W.", contactId: args.contactId, title: args.title, dueDate: args.dueDate }
      };
    }
  });
  assert.match(result.reply, /GHL task on Michelle W/);
  assert.match(result.reply, /not a calendar event/i);
});

test("a different person or phone switches off the pinned GHL contact", async () => {
  const toolCalls = [];
  const result = await maybeContinueCrmTask({
    text: "create a GHL task on David Grossman due Friday",
    history: [],
    scratch: {
      contactId: "contact-michelle-1",
      spokenName: "Michelle",
      storedName: "Michelle W.",
      phoneLast4: "2363"
    },
    speaker: yahoska,
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      assert.equal(name, "ghl_create_contact_task");
      assert.equal(args.contactQuery, "David Grossman");
      assert.equal(Object.hasOwn(args, "contactId"), false);
      return {
        needsConfirmation: true,
        proposed: { contact: "David G.", contactId: "contact-david-1", title: args.title, dueDate: args.dueDate }
      };
    }
  });
  assert.equal(toolCalls.length, 1);
  assert.match(result.reply, /David G/);
});

test("pinned-contact id miss does not fall back to a name multi-match", async () => {
  const result = await maybeContinueCrmTask({
    text: "Create a GHL task on that contact due tomorrow",
    history: [],
    scratch: {
      contactId: "contact-michelle-1",
      spokenName: "Michelle",
      storedName: "Michelle W.",
      phoneLast4: "2363"
    },
    speaker: yahoska,
    executeTool: async (name, args) => {
      assert.equal(name, "ghl_create_contact_task");
      assert.equal(args.contactId, "contact-michelle-1");
      assert.equal(Object.hasOwn(args, "contactQuery"), false);
      return {
        error: "Couldn't load that GHL contact by id. I did not search other contacts by name."
      };
    }
  });
  assert.match(result.reply, /Couldn’t preview that GHL task/);
  assert.match(result.reply, /contact-michelle-1/);
  assert.match(result.reply, /did not search other contacts by name/);
  assert.doesNotMatch(result.reply, /More than one GHL contact matched/);
  assert.match(result.reply, /will not put this on Google Calendar/);
});

test("yes after a GHL task preview saves the CRM task", async () => {
  const result = await maybeContinueCrmTask({
    text: "Yes",
    history: [{ role: "assistant", content: "GHL task on Michelle W.: “Follow up” due Thu. Say yes and I’ll save it." }],
    scratch: {
      contactId: "contact-michelle-1",
      storedName: "Michelle W.",
      phoneLast4: "2363",
      goal: "create_task",
      pending: {
        tool: "ghl_create_contact_task",
        approved: false,
        args: {
          contactId: "contact-michelle-1",
          title: "Follow up",
          dueDate: "2026-09-23T13:00:00.000Z"
        }
      }
    },
    speaker: yahoska,
    executeTool: async (name, args) => {
      assert.equal(name, "ghl_create_contact_task");
      assert.equal(args.confirmed, true);
      assert.equal(args.contactId, "contact-michelle-1");
      return { created: true, contact: "Michelle W.", title: "Follow up" };
    }
  });
  assert.match(result.reply, /Saved the GHL task/);
  assert.match(result.reply, /not a calendar/);
  assert.equal(result.scratch.pending, null);
});

test("contact preview survives to a later sí and creates only the saved draft", async () => {
  const preview = applyCrmToolResult(null, "ghl_create_contact", {
    firstName: "Maria",
    lastName: "Rivera",
    phone: "3055552363",
    email: "maria@example.com",
    tags: ["active_prospect", "prospect"],
    owner: "Katy"
  }, {
    needsConfirmation: true,
    proposed: { firstName: "Maria", lastName: "Rivera", assignedTo: "katy-user-id" }
  });
  assert.equal(preview.pending.tool, "ghl_create_contact");
  assert.equal(preview.pending.args.phone, "3055552363");

  let writes = 0;
  const result = await maybeContinueCrmTask({
    text: "sí",
    history: [{ role: "assistant", content: "I can create Maria Rivera. Say yes to confirm." }],
    scratch: preview,
    speaker: yahoska,
    executeTool: async (name, args) => {
      writes += 1;
      assert.equal(name, "ghl_create_contact");
      assert.equal(args.confirmed, true);
      assert.equal(args.phone, "3055552363");
      assert.equal(args.assignedTo, "katy-user-id");
      return { created: true, contactId: "contact-maria-1", contact: "Maria R." };
    }
  });
  assert.equal(writes, 1);
  assert.equal(result.scratch.contactId, "contact-maria-1");
  assert.equal(result.scratch.pending, null);
  assert.match(result.reply, /intake can continue/i);
  assert.match(result.reply, /note next/i);
});
