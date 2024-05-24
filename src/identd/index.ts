import * as net from 'net';
import * as iconv from 'iconv-lite';
import { CHARSETS, OPSYS, ERROR_TOKENS } from './common/constants.js';

interface Options {
    address : string;
    port? : number; // identd port 113 defualt
    server_port : number; // local port from the machine
    client_port : number; // remote port where the machine is connected
    abort? : boolean; // Abort a connection if they receive 1000 characters without receiving an <EOL>.
};

// character set from RFC-1340
// 6193, 23 : USERID : UNIX : stjohns
// 6195, 23 : ERROR : NO-USER
interface Response {
    server_port : number; // x, y
    client_port : number;
    status : string; // ERROR / USERID
    opsys? : string;
    userid? : string | Buffer;
    error? : string;
    charset? : string; // for userid
}

const Errors : Record<string, string> = {
    UNDEFINED_LOCAL_ADDRESS: 'Undefined address!',
    UNDEFINED_SERVER_PORT: 'Undefined server prot!',
    UNDEFINED_LOCAL_PORT: 'Undefined local port!',
    INVALID_RESPONSE_LENGTH: 'Invalid response length!',
    INVALID_STATUS_RESPONSE: 'Invalid status response!',
    INVALID_OPSYS_RESPONSE: 'Invalid opsys response!',
    INVALID_CHARSET_RESPONSE: 'Invalid charset response!',
    INVALID_USERID_LENGTH: 'Invalid userid length!',
    INVALID_ERROR_TOKEN: 'Invalid error token length!',
}

// <EOL> ::= "015 012" (octal) ; CR-LF End of Line Indicator
const EOL : string = '\r\n';
const CR : number = 0o15; // \r
const LF : number = 0o12; // \n
const COLON : number = 0o72; // :

// Clients should feel free to abort a connection if they receive 1000 characters without receiving an <EOL>.
const ABORT_CONNECTION_LENGTH = 1000;
const READ_BUFFER_LENGTH : number = 256;
const MAX_USERID_LENGTH : number = 512;
const MAX_TOKEN_LENGTH : number = 64;
const DEFAULT_CHARSET : string = 'US-ASCII';

class Identd {

    private static checkOptions(options : Options){
        if(!options.address) throw new Error(Errors.UNDEFINED_LOCAL_ADDRESS);
        else if(!options.server_port) throw new Error(Errors.UNDEFINED_SERVER_PORT);
        else if(!options.client_port) throw new Error(Errors.UNDEFINED_LOCAL_PORT);

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
    public static async request(options : Options) : Promise<Response> { // change this to static, pass the options here
        this.checkOptions(options);
        return new Promise((resolv, reject) => {
            let data : Buffer = Buffer.from([]);
            const sock : net.Socket = net.createConnection({
                host : options.address,
                port : options.port,
                onread: {
                    buffer: Buffer.alloc(READ_BUFFER_LENGTH),
                    callback: (nread : number, arr : Uint8Array) => {
                        const buff : Buffer = Buffer.from(arr.slice(0, nread));
                        data = Buffer.concat([data, buff]);
                        const index : number = this.isEOL(data);

                        if(index !== -1){
                            const res : Buffer = data.subarray(0, index);
                            data = data.subarray(index + 2, data.length); // don't care about if the start is bigger than the end
                            sock.end();

                            try {
                                resolv(this.parseResponse(res));
                            } catch(err){
                                reject(err);
                            };
                        } else if(options.abort && data.length > ABORT_CONNECTION_LENGTH){
                            sock.destroy();
                            throw new Error(Errors.INVALID_RESPONSE_LENGTH);
                        };

                        return true;
                    },
                },
            });

            sock.on('connect', () => {
                sock.write(this.buildRequest(options.server_port, options.client_port));
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
    private static isEOL(buff : Buffer) : number {
        const index : number = buff.indexOf(CR);
        if(index !== -1 && buff.indexOf(LF) - 1 === index) return index;
        else return -1;
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
    private static parseResponse(buff : Buffer) : Response {
        // port pair
        let response : Partial<Response> = {};
        let arr : Buffer[] = this.splitBuffer(buff, COLON);

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

            if(!this.isValidOS(response.opsys)) throw new Error(Errors.INVALID_OPSYS_RESPONSE);
            else if(foo[1]){
                response.charset = foo[1].trim();
                if(!this.isValidCharset(response.opsys)) throw new Error(Errors.INVALID_CHARSET_RESPONSE);
                response.userid = arr[3];
            }else {
                response.userid = this.defaultDecode(arr[3]);
                if(!this.isValidUserID(response.userid)) throw new Error(Errors.INVALID_USERID_LENGTH);
            };
        }else if(response.status === 'ERROR'){
            response.error = str;
            if(!this.isValidErrorToken(response.error)) throw new Error(Errors.INVALID_ERROR_TOKEN);
        }else throw new Error(Errors.INVALID_STATUS_RESPONSE);

        return <Response> response;
    };

    private static defaultDecode(buff : Buffer) : string {
        return iconv.decode(buff, DEFAULT_CHARSET)
    };

    private static splitBuffer(buff : Buffer, char : number) : Buffer[] {
        let arr : Buffer[] = [];
        let index : number;
        while((index = buff.indexOf(char)) !== -1){
            arr.push(buff.subarray(0, index));
            buff = buff.subarray(index + 1);
        };

        if(buff.length > 0) arr.push(buff.subarray(0));
        return arr;
    };

    /*
     * <port-on-server> , <port-on-client>
     * where <port-on-server> is the TCP port (decimal) on the target (where
     * the "ident" server is running) system, and <port-on-client> is the
     * TCP port (decimal) on the source (client) system.
     */
    private static buildRequest(server_port : number, client_port : number) : string {
        return `${server_port}, ${client_port}${EOL}`;
    };

    private static isValidOS(os : string) : boolean {
        return os === 'OTHER' || OPSYS.indexOf(os) !== -1;
    };

    private static isValidCharset(charset : string) : boolean {
        return CHARSETS.indexOf(charset) !== -1;
    };
    
    private static isValidUserID(userid : string) : boolean {
        return userid.length > 0 && userid.length <= MAX_USERID_LENGTH;
    };

    /*private static isValidToken(token : string) : boolean {
        return token.length > 0 && token.length <= this.MAX_TOKEN_LENGTH;
    };*/

    private static isValidErrorToken(error_token : string) : boolean {
        return error_token.length > 1 
            && error_token.length <= MAX_TOKEN_LENGTH 
            && (ERROR_TOKENS.indexOf(error_token) !== -1 || error_token[0] === 'X');
    };

};

export default Identd;
export {
    Errors
};