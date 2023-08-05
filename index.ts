import "websocket-polyfill";
import * as Nostr from "nostr-tools";
const franc: any = require('franc-min');

const SOURCE_RELAY = process.env.SOURCE_RELAY || "";
const DESTINATION_RELAY = process.env.DESTINATION_RELAY || "";
const BOT_LIST_PUBKEY = process.env.BOT_LIST_PUBKEY || "";
const LANGUAGE_DETECTION = evalToggleValue("LANGUAGE_DETECTION", true);
const PASS_LANGUAGE = "jpn";

if (SOURCE_RELAY === "" || DESTINATION_RELAY === "" || BOT_LIST_PUBKEY === "") {
  console.log("Environment value error!");
  console.log({ SOURCE_RELAY, DESTINATION_RELAY, BOT_LIST_PUBKEY });
  process.exit(2);
};

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
  }, 55 * 60 * 1000);

  async function duplicateEvents() {
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
      followers = event.tags.filter((t) => (t[0] === "p")).map((t) => (t[1]));
      console.log("Followers: ", JSON.stringify(followers));
      subscribeFollowers.unsub();

      const subscribeEvents = pool.sub([SOURCE_RELAY], [{
        authors: [...(new Set(followers))],
        kinds: [0, 1, 5],
        since: Math.floor((new Date().getTime() / 1000) - 60 * 60),
      }]);
      subscribeEvents.on("event", (event) => {
        console.log("Received event: ", JSON.stringify(event));

        switch (event.kind) {
          case 0: case 5: {
            const pub = pool.publish([DESTINATION_RELAY], event);
            pub.on("ok", () => {
              console.log("Publish OK: ", event.id, event.kind);
            });
            pub.on("failed", () => {
              console.log("Publish NG: ", event.id, event.kind);
            })
          } break;
          case 1: {
            let event_lang = PASS_LANGUAGE;
            if (LANGUAGE_DETECTION) {
              event_lang = franc(event.content.replace(/[\x00-\x7F]/g, "").repeat(50));
            }

            if (event_lang === PASS_LANGUAGE) {
              const pub = pool.publish([DESTINATION_RELAY], event);
              pub.on("ok", () => {
                console.log("Publish OK: ", event.id, event_lang, JSON.stringify(event.content));
              });
              pub.on("failed", () => {
                console.log("Publish NG: ", event.id, event_lang, JSON.stringify(event.content));
              })
            } else {
              console.log("Publish skipped.", event.id, event_lang, JSON.stringify(event.content));
            }
          } break;
        }
      })
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