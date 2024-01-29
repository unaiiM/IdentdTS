import * as net from 'net';
import * as iconv from 'iconv-lite';
import charsets from './charset.js';
import opsys_list from './opsys.js';

export interface Options {
    address : string;
    port? : number; // identd port 113 defualt
    server_port : number; // local port from the machine
    client_port : number; // remote port where the machine is connected
    abort? : boolean; // Abort a connection if they receive 1000 characters without receiving an <EOL>.
};

// character set from RFC-1340
// 6193, 23 : USERID : UNIX : stjohns
// 6195, 23 : ERROR : NO-USER
export interface Response {
    server_port : number; // x, y
    client_port : number;
    status : string; // ERROR / USERID
    opsys? : string;
    userid? : string | Buffer;
    error? : string;
    charset? : string; // for userid
}

export default class Identd {

    // <EOL> ::= "015 012" (octal) ; CR-LF End of Line Indicator
    private readonly EOL : string = '\r\n';
    private readonly CR : number = 0o15; // \r
    private readonly LF : number = 0o12; // \n
    private readonly COLON : number = 0o72; // :
    // Clients should feel free to abort a connection if they receive 1000 characters without receiving an <EOL>.
    private readonly ABORT_CONNECTION_LENGTH = 1000;
    private readonly READ_BUFFER_LENGTH : number = 256;
    private readonly DEFAULT_CHARSET = 'US-ASCII';

    constructor(private options : Options){
        if(!options.address) throw new Error('Undefined ip!');
        else if(!options.server_port) throw new Error('Undefined server prot!');
        else if(!options.client_port) throw new Error('Undefined local port!');

        options.port = options.port ?? 113;
        options.abort = options.abort ?? true;
    };

    /**
     * Clients should feel free to abort a connection if they receive 1000 characters without receiving an <EOL>.
     * this is for whitespaces, bcs the response could have a lot of whitespaces if the server wants it
     * maybe check if the query ports correspond with requested ports ?
     * --
     * Any premature close (i.e., one where the client does not receive the EOL, whether graceful or an abort should 
     * be considered to have the same meaning as "ERROR : UNKNOWN-ERROR".
     */
    public async request(cb : (err? : Error, info? : Response) => void) : Promise<void> { // change this to static, pass the options here
        let response : Response = await new Promise((resolv, reject) => {
            let data : Buffer = Buffer.from([]);
            const sock : net.Socket = net.createConnection({
                host : this.options.address,
                port : this.options.port,
                onread: {
                    buffer: Buffer.alloc(this.READ_BUFFER_LENGTH),
                    callback: (nread : number, arr : Uint8Array) => {
                        const buff : Buffer = Buffer.from(arr.slice(0, nread));
                        data = Buffer.concat([data, buff]);
                        const index : number = this.isEOL(data);

                        if(index !== -1){
                            const res : Buffer = data.subarray(0, index);
                            data = data.subarray(index + 2, data.length); // don't care about if the start is bigger than the end
                            sock.end();
                            resolv(this.parseResponse(res));
                        } else if(this.options.abort && data.length > this.ABORT_CONNECTION_LENGTH) sock.destroy(); // do somthing else 
                        return true;
                    },
                },
            });

            sock.on('connect', () => {
                sock.write(this.generateRequest(this.options.rport, this.options.lport));
            });

            sock.on('error', (err : Error) => {
                reject(err);
            });
        });
    };

    /**
     * Check if is there end of line in the buffer without converting it
     * to string making it more faster; extra mem usage, etc.
     */
    private isEOL(buff : Buffer) : number {
        const index : number = buff.indexOf(this.CR);
        if(index !== -1 && buff.indexOf(this.LF) - 1 === index) return index;
        else return -1;
    };

    /**
     * <request> ::= <port-pair> <EOL>
     * <port-pair> ::= <integer> "," <integer>
     */
    private generateRequest(rport : number, lport : number) : string {
        return rport + "," + lport + this.EOL;
    };

    /**
     * <reply> ::= <reply-text> <EOL>
     * <reply-text> ::= <error-reply> | <ident-reply>
     * <port-pair> ::= <integer> "," <integer>
     * <integer> ::= 1*5<digit> ; 1-5 digits.
     * <error-reply> ::= <port-pair> ":" "ERROR" ":" <error-type>
     * <ident-reply> ::= <port-pair> ":" "USERID" ":" <opsys-field> ":" <user-id>
     * <error-type> ::= "INVALID-PORT" | "NO-USER" | "UNKNOWN-ERROR" | "HIDDEN-USER" |  <error-token>
     * <opsys-field> ::= <opsys> [ "," <charset>]
     * <opsys> ::= "OTHER" | "UNIX" | <token> ...etc. ;  (See "Assigned Numbers")
     * <charset> ::= "US-ASCII" | ...etc.;  (See "Assigned Numbers")
     * <user-id> ::= <octet-string> ; 512 character limit
     * <token> ::= 1*64<token-characters> ; 1-64 characters, 64 limit
     * <error-token> ::= "X"1*63<token-characters>; 2-64 chars beginning w/X
     * --
     * <token-characters> ::= <Any of these ASCII characters: a-z, A-Z,
     * - (dash), .!@#$%^&*()_=+.,<>/?"'~`{}[]; >
     * ; upper and lowercase a-z plus
     * ; printables minus the colon ":"
     * ; character.
     * --
     * all other fields will be defined in and must be sent as US-ASCII.
     * --
     * space characters (040) following the colon separator ARE part of the identifier string and
     * may not be ignored.
     * --
     * "OTHER" indicates the identifier is an unformatted character string.
     * this just means that is not an user indentification, could be a email or tel number, etc.
     * --
     * the concept of token is just the <opsys> value
     * no white spaces in token
     * --
     * only the beggining and ending white spaces will be taken as a part of the userid
     */
    private parseResponse(buff : Buffer) : Response {
        // port pair
        let response : Partial<Response> = {};
        let arr : Buffer[] = this.splitBuffer(buff, this.COLON);

        let str : string = this.defaultDecode(arr[0]);
        let foo : string[] = str.split(',');
        response.server_port = parseInt(foo[0]); // trim is alredy done it by parseInt func
        response.client_port = parseInt(foo[1]);

        str = this.defaultDecode(arr[1]).trim();
        response.status = str;

        str = this.defaultDecode(arr[2]).trim();
        if(response.status === 'USERID'){
            foo = str.split(',');
            response.opsys = foo[0].trim();

            if(foo[1]){
                response.charset = foo[1].trim();
                response.userid = arr[3];
            }else {
                response.userid = this.defaultDecode(arr[3]);
            };
        }else if(response.status === 'ERROR'){
            response.error = str;
        }else {
            // some error log
        };

        return <Response> response;
    };

    private defaultDecode(buff : Buffer) : string {
        return iconv.decode(buff, this.DEFAULT_CHARSET)
    };

    private splitBuffer(buff : Buffer, char : number) : Buffer[] {
        let arr : Buffer[] = [];
        let index : number;
        while((index = buff.indexOf(char)) !== -1){
            arr.push(buff.subarray(0, index));
            buff = buff.subarray(index + 1);
        };

        if(buff.length > 0) arr.push(buff.subarray(0));
        return arr;
    };

    // <port-on-server> , <port-on-client>
    // where <port-on-server> is the TCP port (decimal) on the target (where
    // the "ident" server is running) system, and <port-on-client> is the
    // TCP port (decimal) on the source (client) system.
    private makeRequest(server_port : number, client_port : number) : string {
        return `${server_port}, ${client_port}${this.EOL}`;
    };

    private isValidOS(opsys : string) : boolean {
        return opsys === 'OTHER' || opsys_list.indexOf(opsys) !== -1;
    };

    private isValidCharset(charset : string) : boolean {
        return charsets.indexOf(charset) !== -1;
    };
    
};