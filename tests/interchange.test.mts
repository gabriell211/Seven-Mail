import test from "node:test";
import assert from "node:assert/strict";
import {
  contactsFromCsv,
  contactsFromVcard,
  contactsToCsv,
  contactsToVcard,
  eventsFromIcs,
  eventsToIcs,
  messageToEml,
} from "../src/lib/interchange.ts";

test("ICS round-trip preserves core event fields", () => {
  const original = [{
    id: "evt-1",
    title: "Reunião de teste",
    description: "Descrição\ncom duas linhas",
    location: "Sala 4",
    startAt: "2026-09-25T13:00:00.000Z",
    endAt: "2026-09-25T14:00:00.000Z",
    allDay: false,
    color: "#7868ff",
    participants: ["a@example.com", "b@example.com"],
  }];
  const ics = eventsToIcs(original);
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /BEGIN:VEVENT/);
  const parsed = eventsFromIcs(ics);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, original[0].title);
  assert.equal(parsed[0].location, original[0].location);
  assert.deepEqual(parsed[0].participants, original[0].participants);
  assert.equal(new Date(parsed[0].startAt).toISOString(), original[0].startAt);
});

test("vCard and CSV round-trip preserve contact identity", () => {
  const contacts = [{
    id: "contact-1",
    displayName: "Gabriel Teste",
    email: "gabriel@example.com",
    phone: "+55 48 99999-0000",
    company: "Seven",
    jobTitle: "TI",
    notes: "Contato de teste",
    favorite: true,
  }];

  const vcard = contactsToVcard(contacts);
  const parsedVcard = contactsFromVcard(vcard);
  assert.equal(parsedVcard[0].displayName, contacts[0].displayName);
  assert.equal(parsedVcard[0].email, contacts[0].email);

  const csv = contactsToCsv(contacts);
  const parsedCsv = contactsFromCsv(csv);
  assert.equal(parsedCsv[0].displayName, contacts[0].displayName);
  assert.equal(parsedCsv[0].favorite, true);
});

test("EML export emits RFC-style MIME envelope", () => {
  const eml = messageToEml({
    id: "m-1",
    accountId: "a-1",
    folder: "Caixa de entrada",
    subject: "Teste EML",
    preview: "Olá",
    from: { name: "Remetente", email: "from@example.com" },
    to: [{ name: "Destino", email: "to@example.com" }],
    receivedAt: "2026-09-25T13:00:00.000Z",
    isRead: false,
    isFlagged: false,
    isPinned: false,
    hasAttachments: false,
    bodyText: "Olá mundo",
    bodyHtml: "<p>Olá mundo</p>",
    categories: [],
  });

  assert.match(eml, /^From:/m);
  assert.match(eml, /^To:/m);
  assert.match(eml, /^Subject: Teste EML/m);
  assert.match(eml, /^MIME-Version: 1\.0/m);
  assert.match(eml, /multipart\/alternative/);
  assert.match(eml, /Olá mundo/);
});
