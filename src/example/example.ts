import Identd, { Response } from "../identd";

Identd.request({
    address: '172.26.41.85',
    server_port: 39904,
    client_port: 4444
})
.then((response : Response) => console.log(response))
.catch(err => console.log("Some error: " + err));
