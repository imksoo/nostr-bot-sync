import "websocket-polyfill";
import * as Nostr from "nostr-tools";
const franc: any = require('franc-min');

const NODE_ENV = process.env.NODE_ENV || "production";
if (NODE_ENV === "production") {
  console.debug = (...data) => {
  };
}

const SOURCE_RELAY = process.env.SOURCE_RELAY || "";
const DESTINATION_RELAY = process.env.DESTINATION_RELAY || "";
const BOT_LIST_PUBKEY = process.env.BOT_LIST_PUBKEY || "";
const BLOCK_BOT_LIST_PUBKEY = process.env.BLOCK_BOT_LIST_PUBKEY || "";
const BLOCK_PUBKEYS = process.env.BLOCK_PUBKEYS || "";
const LANGUAGE_DETECTION = evalToggleValue("LANGUAGE_DETECTION", true);
const PASS_LANGUAGE = "jpn";

const contentFilters: RegExp[] = [
  /avive/i,
  /web3/i,
  /lnbc/,
  /t\.me/,
  /nostr-vip\.top/,
  /1C-0OTP4DRCWJY17XvOHO/,
  /\$GPT/,
  /Claim your free/,
  /Claim Free/i,
  /shop\.55uu\.wang/,
  /dosoos/i,
  /coderba/i,
  /人工智能/,
  /dapp/,
  /motherfuckers/,
  /shitspaming/,
  /telegra\.ph/,
  /nsfw/i,
];

if (SOURCE_RELAY === "" || DESTINATION_RELAY === "" || BOT_LIST_PUBKEY === "") {
  console.log("Environment value error!");
  console.log({ SOURCE_RELAY, DESTINATION_RELAY, BOT_LIST_PUBKEY });
  process.exit(2);
};

console.log("Started nostr-bot-sync");
console.debug(JSON.stringify({ SOURCE_RELAY, DESTINATION_RELAY, BOT_LIST_PUBKEY, BLOCK_PUBKEYS, LANGUAGE_DETECTION, PASS_LANGUAGE }, undefined, 2))

async function main() {
  const srcRelay = Nostr.relayInit(SOURCE_RELAY);
  srcRelay.on("error", () => {
    console.log("Source relay error!");
    process.exit(1);
  })
  srcRelay.on("disconnect", () => {
    console.log("Source relay disconnected.");
    process.exit(1);
  });
  const srcRelayTimeout = setTimeout(() => {
    console.log("Source relay timeout.");
    process.exit(1);
  }, 10 * 1000);
  await srcRelay.connect();
  console.log("Source relay connected.");
  clearTimeout(srcRelayTimeout);

  const destRelay = Nostr.relayInit(DESTINATION_RELAY);
  destRelay.on("error", () => {
    console.log("Destination relay error!");
    process.exit(1);
  })
  destRelay.on("disconnect", () => {
    console.log("Destination relay disconnected.");
    process.exit(1);
  });
  const destRelayTimeout = setTimeout(() => {
    console.log("Destination relay timeout.");
    process.exit(1);
  }, 10 * 1000);
  await destRelay.connect();
  console.log("Destination relay connected.");
  clearTimeout(destRelayTimeout);

  const pool = new Nostr.SimplePool();

  duplicateEvents();

  setTimeout(() => {
    console.log("Interval restart.");
    process.exit(0);
  }, Math.floor((5.5 - Math.random()) * 60) * 1000);

  async function duplicateEvents() {
    let blockers: string[];
    if (BLOCK_BOT_LIST_PUBKEY) {
      console.log("Collecting blockers...");
      const subscribeBlockers = pool.sub([SOURCE_RELAY, DESTINATION_RELAY], [{
        kinds: [3],
        authors: [BLOCK_BOT_LIST_PUBKEY],
        limit: 1,
      }]);
      subscribeBlockers.on("event", (event) => {
        blockers = event.tags.filter((t) => (t[0] === "p")).map((t) => (t[1]));
        console.debug("Blokers=", blockers);
      });
    }

    console.log("Collecting follows...");
    let followers: string[];
    const collectFollowsTimeout = setTimeout(() => {
      console.log("Collect follows timeout.");
      process.exit(1);
    }, 30 * 1000);
    const subscribeFollowers = pool.sub([SOURCE_RELAY, DESTINATION_RELAY], [{
      kinds: [3],
      authors: [BOT_LIST_PUBKEY],
      limit: 1,
    }]);
    subscribeFollowers.on("event", (event) => {
      clearTimeout(collectFollowsTimeout);
      followers = [...new Set(event.tags.filter((t) => (t[0] === "p")).map((t) => (t[1])))];
      console.debug("Followers: ", JSON.stringify(followers));
      subscribeFollowers.unsub();

      const subscribeKind0and5 = pool.sub([SOURCE_RELAY], [{
        kinds: [0, 5],
        since: Math.floor((new Date().getTime() / 1000) - 10 * 60),
      }]);
      subscribeKind0and5.on("event", (event) => { transmitEvent(event, pool, blockers) });

      const splitLength = 1000;
      for (let begin = 0; begin < followers.length; begin += splitLength) {
        const end = begin + splitLength
        const subFollowers = followers.slice(begin, end);

        const subscribeEvents = pool.sub([SOURCE_RELAY], [{
          authors: subFollowers,
          kinds: [0, 1, 2, 3, 5, 10000, 10002, 30000],
          since: Math.floor((new Date().getTime() / 1000) - 10 * 60),
        }]);
        subscribeEvents.on("event", (event) => { transmitEvent(event, pool, blockers) });
      }
    });
  }
}

main();

function evalToggleValue(envVarName: string, defaultValue: boolean = true): boolean {
  const envValue = process.env[envVarName]?.toLowerCase();
  if (!envValue) {
    return defaultValue;
  } else if (envValue === "true" || envValue === "on") {
    return true;
  } else if (envValue === "false" || envValue === "off") {
    return false;
  } else {
    return defaultValue;
  }
}

function transmitEvent(event: Nostr.Event<0 | 1 | 2 | 3 | 5 | 10000 | 10002 | 30000>, pool: Nostr.SimplePool, blockers: string[]) {
  console.log("Received event: ", JSON.stringify(event));

  let isProxyEventOfActivityPub = false;
  let isProxyEvent = false;
  let sourceActivityPubUrl = "";
  for (let i = 0; i < event.tags.length; ++i) {
    if (event.tags.length > 2 && event.tags[i][0] === "proxy" && event.tags[i][2] === "activitypub") {
      isProxyEventOfActivityPub = true;
      sourceActivityPubUrl = event.tags[i][2];
    } else if (event.tags[i][0] === "proxy") {
      isProxyEvent = true;
    }
  }
  if (isProxyEventOfActivityPub) {
    console.log("ActivityPub proxy event is ignored.", event.id, sourceActivityPubUrl);
    return;
  } else if (isProxyEvent) {
    console.log("Proxy event is ignored.", event.id);
    return;
  }

  const isPubkeyBlocked = (BLOCK_PUBKEYS.includes(event.pubkey) || blockers.includes(event.pubkey));
  if (isPubkeyBlocked) {
    console.log("Blocked pubkey.", event.id, event.pubkey);
    return;
  }

  if (event.kind === 1) {
    let shouldRelay = true;
    for (const filter of contentFilters) {
      if (filter.test(event.content)) {
        shouldRelay = false;
        break;
      }
    }
    if (shouldRelay === false) {
      console.log("Blocked content.", event.id, event.content);
      return;
    }
  }

  switch (event.kind) {
    case 1: {
      let event_lang = PASS_LANGUAGE;
      if (LANGUAGE_DETECTION) {
        event_lang = franc(event.content.replace(/[\x00-\x7F]/g, "").repeat(50));
      }

      if (event_lang === PASS_LANGUAGE) {
        const pub = pool.publish([DESTINATION_RELAY], event);
        pub.on("ok", () => {
          console.log("Publish OK: ", event.id, `kind=${event.kind}`, event_lang, JSON.stringify(event.content));
        });
        pub.on("failed", () => {
          console.log("Publish NG: ", event.id, `kind=${event.kind}`, event_lang, JSON.stringify(event.content));
        })
      } else {
        console.log("Publish skipped.", event.id, `kind=${event.kind}`, event_lang, JSON.stringify(event.content));
      }
    } break;
    default: {
      const pub = pool.publish([DESTINATION_RELAY], event);
      pub.on("ok", () => {
        console.log("Publish OK: ", event.id, `kind=${event.kind}`);
      });
      pub.on("failed", () => {
        console.log("Publish NG: ", event.id, `kind=${event.kind}`);
      })
    }
  }
}