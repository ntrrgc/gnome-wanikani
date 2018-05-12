const Soup = imports.gi.Soup;
const Lang = imports.lang;
const GLib = imports.gi.GLib
const Mainloop = imports.mainloop;

const blackHoleAnnounceFn = (announcement) => {};

const wkApiKeyPaths = [
    "~/.wanikani-api-key",
    "~/Dropbox/.wanikani-api-key",
    "~/.config/wanikani-api-key"
].map(path => path.replace("~", GLib.get_home_dir()));

function findWKApiKey() {
    for (let path of wkApiKeyPaths) {
        let fileText;
        try {
            fileText = GLib.file_get_contents(path)[1].toString();
        } catch (err) {
            continue;
        }
        return fileText.trim();
    }
    log("Could not found an API key in any of the following paths:\n" + wkApiKeyPaths.join("\n") +
        "\nPlease create a file in any of these paths with your WaniKani v1 API key in order for " +
        "the review widget to work.");
}

const wkApiKey = findWKApiKey();

/* Wrap a callback with the switch latest operator.
 * The returned callback only does something when executed if a newer callback
 * has not been wrapped since then.
 */
class SwitchLatestOperator {
    constructor() {
        this.latestIndex = 0;
    }

    wrap(callback) {
        const self = this;
        const returnedCallbackIndex = ++this.latestIndex;
        return function returnedCallback() {
            if (returnedCallbackIndex === self.latestIndex) {
                return callback.apply(this, arguments);
            } else {
                return false;
            }
        }
    }
}

class OrderedRequestResponseOperator {
    constructor() {
        this.latestRequestSent = 0;
        this.latestRequestResponseReceived = 0;
    }

    wrapResponseCallback(responseCallback) {
        // This method is called during request time.
        const requestNumber = ++this.latestRequestSent;
        return () => {
            if (requestNumber <= this.latestRequestResponseReceived) {
                // Discard this response.
                return;
            }
            this.latestRequestResponseReceived = requestNumber;
            return responseCallback.apply(null, arguments);
        }
    }
}

function pad2(num) {
    if (num < 10) {
        return "0" + num;
    } else {
        return "" + num;
    }
}

var WKTracker = new Lang.Class({
    Name: "WKTracker",

    _init() {
        this.latestReviewInfo = null;
        this.enabled = false; // whether requests will be sent
        this.announceFn = blackHoleAnnounceFn;
        this.httpSession = new Soup.SessionAsync();
        this.orderedOperatorServerReviewData = new OrderedRequestResponseOperator();
        this.switchLatestTimedReviewData = new SwitchLatestOperator();
    },

    enableUpdates(announceFn) {
        this.announceFn = announceFn;
        this.announceFn({text: "WK 待ってください", reviewsAvailable: null});

        // Enable polling of the review queue
        this.enabled = true;

        // Make the first request, but not immediately, wait 1 second before just in case the extension
        // gets immediately disabled (which happens sometimes during GNOME start-up for unknown reasons)
        Mainloop.timeout_add_seconds(1, this.orderedOperatorServerReviewData.wrapResponseCallback(() => {
            if (this.enabled) {
                this._makeUpdateRequest();
            }
            return false; // don't repeat this timer
        }));

        const pollingIntervalSeconds = 10 * 60;
        Mainloop.timeout_add_seconds(pollingIntervalSeconds, this.orderedOperatorServerReviewData.wrapResponseCallback(() => {
            // The extension may have been disabled since the task was enqueued.
            if (this.enabled) {
                this._makeUpdateRequest();
            }
            return true;
        }));
    },

    disableUpdates() {
        this.announceFn = blackHoleAnnounceFn;
        this.enabled = false;
    },

    _makeUpdateRequest() {
        // realUrl = `https://www.wanikani.com/api/user/${wkApiKey}/study-queue`
        const request = Soup.Message.new("GET", `https://www.wanikani.com/api/user/${wkApiKey}/study-queue`);
        this.httpSession.queue_message(request, (httpSession, message) => {
            const responseText = message.response_body.flatten().get_data().toString();
            // print(responseText)

            try {
                const parsedResponse = JSON.parse(responseText);
                this._receivedUpdateResponse(parsedResponse);
            } catch (err) {
                log(`Failed to parse server response: ${responseText}`);
            }
        });
    },

    _receivedUpdateResponse(parsedResponse) {
        print(JSON.stringify(parsedResponse));
        this.latestReviewInfo = parsedResponse;
        this._newServerReviewInfo();
    },

    _newServerReviewInfo() {
        const reviewsAvailable = this.latestReviewInfo.requested_information.reviews_available;
        const timeToNextReviewFullMs = Math.max(0,
            new Date(this.latestReviewInfo.requested_information.next_review_date).getTime() -
            new Date().getTime());

        let remainderTotalSeconds = Math.ceil(timeToNextReviewFullMs / 1000);
        const hours = Math.floor(remainderTotalSeconds / 3600);
        remainderTotalSeconds = remainderTotalSeconds % 3600;
        const minutes = Math.floor(remainderTotalSeconds / 60);
        remainderTotalSeconds = remainderTotalSeconds % 60;
        const seconds = Math.floor(remainderTotalSeconds);

        let text;
        if (reviewsAvailable > 0) {
            text = `WK ${reviewsAvailable}枚`
        } else if (timeToNextReviewFullMs > 0) {
            text = `WK ${hours}h${pad2(minutes)}m`
        } else {
            text = 'WK Vacation mode'
        }
        const announcement = {
            text: text,
            reviewsAvailable: reviewsAvailable,
        };

        this.announceFn(announcement);
        if (reviewsAvailable === 0 && timeToNextReviewFullMs > 0) {
            // When the current minute in the countdown ends, emit a new announcement.

            // We wait `seconds + 2`. One extra second is to account for the truncation
            // made when calculating `seconds`. The other one is to avoid hitting exactly
            // seconds = 0, which belongs to the same minute and therefore would not
            // actually require an update.
            const secondsToNextUpdate = seconds + 2;
            Mainloop.timeout_add_seconds(secondsToNextUpdate,
                this.switchLatestTimedReviewData.wrap(() => {
                    this._newServerReviewInfo();
                    return false; // don't let glib repeat this callback by itself
                }));
        }
    }
});