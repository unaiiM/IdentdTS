# Ident Protocol
Ident Protocol is an Internet protocol that helps identify the user of a particular TCP connection.

One popular daemon program for providing the ident service is identd.
# Request Options
* address --> the identd server ip address
* port --> identd server port, if is undefined 113 is used by defualt
* server_port --> local port from the identd server machine
* client_port --> remote port where the identd server machine is connected to
* abort --> feel free to abort a connection if they receive 1000 characters without receiving an <EOL>, by default is true.
# Response Structure    
* server_port --> same as the request options
* client_port --> same as the request options
* status --> status of the response
* opsys --> opsys type, if opsys is defined, then is an ident reply
* userid --> userid string or Buffer, if userid is defined, then is an ident reply
* error --> error type, if error type is defined, then is an error reply
* charset --> custom charset, if charset is defined then userid is type of buffer. If is not then userid is an string with US-ASCII charset.
# Error Types
* UNDEFINED_SERVER_PORT --> undefined server prot
* UNDEFINED_LOCAL_PORT --> undefined local port
* INVALID_RESPONSE_LENGTH --> invalid response length
* INVALID_STATUS_RESPONSE --> invalid status response
* INVALID_OPSYS_RESPONSE --> invalid opsys response
* INVALID_CHARSET_RESPONSE --> invalid charset response
* INVALID_USERID_LENGTH --> invalid userid length
* INVALID_ERROR_TOKEN --> invalid error token length
# Example
```
import Identd, { Response } from "../identd";

Identd.request({
    address: '172.26.41.85',
    server_port: 39904,
    client_port: 4444
})
.then((response : Response) => console.log(response))
.catch(err => console.log("Some error: " + err));
```
# References
- https://www.rfc-editor.org/rfc/rfc1413 (ident proto)
- https://www.rfc-editor.org/rfc/rfc1340 (for charset)
