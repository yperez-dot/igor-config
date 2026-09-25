function cleanList(values) {
  return [...new Set((values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function firstName(person, fallback = "Client") {
  return String(person?.firstName ?? person?.contact ?? fallback).trim().split(/\s+/)[0] || fallback;
}

function personSection(person, includeHeader) {
  const name = firstName(person);
  const providers = cleanList(person.providers);
  const medications = cleanList(person.medications);
  const lines = includeHeader ? [name, ""] : [];

  if (!providers.length && !medications.length) {
    lines.push(`I don’t have any providers or medications on file for ${includeHeader ? name : "you"} yet. Please send me the doctors and medications ${includeHeader ? `${name} currently sees and takes` : "you currently see and take"}.`);
    return lines.join("\n");
  }

  lines.push("Providers");
  if (providers.length) lines.push(...providers.map((provider) => `- ${provider}`));
  else lines.push(`I don’t have any providers on file for ${includeHeader ? name : "you"} yet. Please send me that list.`);
  lines.push("", "Meds");
  if (medications.length) lines.push(...medications.map((medication) => `- ${medication}`));
  else lines.push(`I don’t have any medications on file for ${includeHeader ? name : "you"} yet. Please send me that list.`);
  lines.push("", "Please confirm that this is correct or send me any changes.");
  return lines.join("\n");
}

export function formatReviewPlansDraft({ people = [], senderName = "Yahoska" } = {}) {
  const entries = (people ?? []).filter(Boolean);
  if (!entries.length) throw new Error("At least one person is required.");
  const names = entries.map((person) => firstName(person));
  const greeting = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const sections = entries.map((person) => personSection(person, entries.length > 1)).join("\n\n");
  return {
    subject: "Updated Meds and Drs",
    body: [
      `Hi ${greeting},`,
      "",
      "I’d like to make sure I have everything right before we review your plans. Please tell me what isn’t working with your current plan and why you’d like to review it.",
      "",
      sections,
      "",
      "Thank you,",
      senderName
    ].join("\n")
  };
}
