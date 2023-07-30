import "websocket-polyfill";
import * as Nostr from "nostr-tools";

const SOURCE_RELAY = "wss://relay.nostr.wirednet.jp";
const DESTINATION_RELAY = "wss://relay-jp.nostr.wirednet.jp";
const BOT_LIST_PUBKEY = "18c3434bf332fcbede0be65df140f1bf9ad1bbf6c923242b5b4ac798c276a35b";

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
  }, 60 * 1000);
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
  }, 60 * 1000);
  await destRelay.connect();
  console.log("Destination relay connected.");
  clearTimeout(destRelayTimeout);

  const pool = new Nostr.SimplePool();

  duplicateEvents();
  setTimeout(() => {
    console.log("Interval restart.");
    process.exit(0);
  }, 5 * 60 * 1000);

  async function duplicateEvents() {
    console.log("Collecting follows...");
    let followers: string[];
    const subscribeFollowers = pool.sub([SOURCE_RELAY, DESTINATION_RELAY], [{
      kinds: [3],
      authors: [BOT_LIST_PUBKEY],
      limit: 1,
    }]);
    subscribeFollowers.on("event", (event) => {
      followers = event.tags.filter((t) => (t[0] === "p")).map((t) => (t[1]));
      console.log("Followers: ", JSON.stringify(followers));
      subscribeFollowers.unsub();

      const subscribeEvents = pool.sub([SOURCE_RELAY], [{
        authors: [...(new Set(followers))],
        since: Math.floor((new Date().getTime() / 1000) - 60 * 60),
      }]);
      subscribeEvents.on("event", (event) => {
        console.log("Received event: ", JSON.stringify(event));
        const pub = pool.publish([DESTINATION_RELAY], event);
        pub.on("ok", () => {
          console.log("Publish OK: ", event.id);
        });
        pub.on("failed", () => {
          console.log("Publish NG: ", event.id);
        })
      })
    });
  }
}

main();