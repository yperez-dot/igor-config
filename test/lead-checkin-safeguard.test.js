import test from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { createStore } from '../src/store.js';
import { processTask, boundedGhlLookup, easternCheckinDay } from '../src/process-task-personal.js';
import { legacySchedules, LIVE_SCHEDULE_IDS } from '../src/legacy-schedules.js';
const environment = { TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_ALLOWED_USER_IDS: '1,2,3', TELEGRAM_YAHOSKA_USER_ID: '1', TELEGRAM_KATY_USER_ID: '2', TELEGRAM_CAROLINA_USER_ID: '3', GHL_API_TOKEN: 'test' };
const now = new Date('2026-09-14T13:10:00Z');
const task = { id: 'morning', created_at: now, payload: { workflow: 'lead_followup_checkin', phase: 'morning' } };
async function fixture() {
  const { Pool } = newDb().adapters.createPg();
  const store = createStore({ pool: new Pool() });
  await store.ready;
  return store;
}
test('catch-up is active at 9:10 Eastern; day uses Eastern including DST', () => {
  const row = legacySchedules.find(s => s.id === 'v2-lead-followup-morning-catchup');
  assert.equal(row.cron, '10 9 * * *');
  assert.equal(row.timezone, 'America/New_York');
  assert.ok(LIVE_SCHEDULE_IDS.includes(row.id));
  assert.equal(easternCheckinDay(new Date('2026-09-15T02:00Z')), '2026-09-14');
  assert.equal(easternCheckinDay(new Date('2026-12-15T04:00Z')), '2026-12-14');
});
test('hung lookup is aborted and fails open to all three personal messages', async () => {
  const store = await fixture();
  const sent = [];
  let aborted = 0;
  const result = await processTask(task, { now, store, environment, ghlTimeoutMs: 5,
    personalGhlLookup: ({ signal }) => new Promise(() => signal.addEventListener('abort', () => aborted++)),
    sendTelegram: async ({chatId, text}) => { assert.match(text, /unavailable from GHL/); sent.push(chatId); }
  });
  assert.equal(result.recipientCount, 3);
  assert.equal(aborted, 3);
  assert.deepEqual(sent, ['1','2','3']);
  await processTask({...task, id:'catchup'}, { now, store, environment, sendTelegram: async () => assert.fail('duplicate') });
  await store.close();
});
test('failed recipient is retried without duplicating successful recipients', async () => {
  const store = await fixture();
  const sent=[];
  const opts = { now, store, environment: {...environment, GHL_API_TOKEN:''}, sendTelegram: async ({chatId}) => { if(chatId === '2') throw new Error('offline'); sent.push(chatId); } };
  await assert.rejects(processTask(task,opts));
  await processTask({...task,id:'catchup'}, {...opts,sendTelegram:async ({chatId})=>sent.push(chatId)});
  assert.deepEqual(sent,['1','3','2']);
  await store.close();
});
test('concurrent claims allow one sender and sent claims stay closed', async () => {
  const store = await fixture();
  assert.equal(await store.claimLeadCheckin('key','a'),true);
  assert.equal(await store.claimLeadCheckin('key','b'),false);
  await store.finishLeadCheckin('key','a','sent');
  assert.equal(await store.claimLeadCheckin('key','c'),false);
  await store.close();
});
test('stale morning task cannot deliver a previous day brief', async () => {
  const result = await processTask(task,{now:new Date('2026-09-15T13:00Z'),environment,sendTelegram:async()=>assert.fail('stale')});
  assert.equal(result.status,'skipped');
});
test('lookup rejection propagates for fail-open handler',async()=>{
  await assert.rejects(boundedGhlLookup(async()=>{throw new Error('GHL unavailable');}),/GHL unavailable/);
});

test('check-ins use their dedicated bot and record Telegram receipts', async () => {
  const events=[];
  const result=await processTask(task,{now, environment:{...environment,GHL_API_TOKEN:'',LEAD_CHECKIN_TELEGRAM_BOT_TOKEN:'current-bot'},
    store:{record:async(type,id,detail)=>events.push({type,id,detail})},
    sendTelegram:async({botToken,chatId})=>{assert.equal(botToken,'current-bot');return {messageId:100+Number(chatId),botId:8677526045};}
  });
  assert.equal(result.recipientCount,3);
  assert.deepEqual(events.map(e=>e.detail.messageId),[101,102,103]);
});
test('other workflows keep their original Telegram bot', async () => {
  await processTask({payload:{workflow:'telegram_reminder',chatId:'1',text:'test'}},{environment:{...environment,LEAD_CHECKIN_TELEGRAM_BOT_TOKEN:'current-bot'},sendTelegram:async({botToken})=>assert.equal(botToken,'test')});
});
test('Telegram application-level failure cannot be recorded as delivered',async()=>{
  const {sendLeadCheckinTelegram}=await import('../src/process-task-personal.js');
  await assert.rejects(sendLeadCheckinTelegram({botToken:'test',chatId:'1',text:'test',fetchImpl:async()=>({ok:true,status:200,json:async()=>({ok:false,error_code:400})})}),/rejected/);
  assert.deepEqual(await sendLeadCheckinTelegram({botToken:'test',chatId:'1',text:'test',fetchImpl:async()=>({ok:true,status:200,json:async()=>({ok:true,result:{message_id:123,from:{id:456},chat:{id:1}}})})}),{messageId:123,botId:456,chatId:1});
});
