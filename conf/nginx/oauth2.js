/*
 * This function is called by the NGINX auth_request directive to perform OAuth 2.0
 * Token Introspection. It uses a subrequest to construct a Token Introspection request
 * to the configured authorization server ($oauth_token_endpoint).
 *
 * Responses are aligned with the valid responses for auth_request:
 * 204: token is active
 * 403: token is not active
 * 401: error condition (details written to error log at error level)
 * 
 * Metadata contained within the token introspection JSON response is converted to response
 * headers. These in turn are available to the auth_request location with the auth_request_set
 * directive. Each member of the response is available to nginx as $sent_http_oauth_<member name>
 *
 */

function introspectAccessToken(r) {
    r.log("OAuth sending introspection: ")
    r.log(" token: " + JSON.stringify(r))
    r.subrequest("/_oauth2_send_introspection_request",
        function(reply) {
            r.log(`Reply: ${JSON.stringify(reply)}`);
            if (reply.status != 200) {
                r.error(`OAuth unexpected response from authorization server`);
                r.return(401);
                return
            }

            try {                
                var response = JSON.parse(reply.responseText);
                // We have a valid introspection response
                // Check for validation success
                if (response.active == true) {
                    r.log("OAuth token introspection found ACTIVE token");
                    // Iterate over all members of the response and return them as response headers
                    for (var p in response) {
                        if (!response.hasOwnProperty(p)) continue;
                        r.log("OAuth token value " + p + ": " + response[p]);
                        r.headersOut['token-' + p] = response[p];
                    }
                    r.status = 204;
                    r.sendHeader();
                    r.finish();
                } else {
                    r.warn("OAuth token introspection found inactive token");
                    r.return(403);
                }
            } catch (e) {
                r.error("OAuth token introspection response is not JSON: " + reply.body);
                r.return(401);
            }
        }
    );
}

function trackAccessRequest(r) {
    r.log("Tracking asset access request: " + JSON.stringify(r))
    r.subrequest("/_oauth2_send_access_tx",
        function(reply) {
            r.log(`Reply: ${JSON.stringify(reply)}`);
            if (reply.status != 200) {
                r.error(`Unable to track asset access request`);                
            }
        }
    );
}

export default { introspectAccessToken, trackAccessRequest }
