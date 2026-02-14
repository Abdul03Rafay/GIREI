const content = `The Pythagorean theorem is ... expressed as:

\\[ c^2 = a^2 + b^2 \\]

where \\( c \\) represents...`;

const regex1 = /(\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])/g;
console.log("Regex 1 Match:", content.match(regex1));

content.replace(regex1, (m, full, a, b) => {
    console.log("Match found:");
    console.log("Full:", m);
    console.log("Group A ($$):", a);
    console.log("Group B (\\[):", b);
    return "REPLACED";
});
